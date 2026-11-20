import type {Database} from "./database";
/** Scratch is recoverable for one hour after execution. Unattached uploads
 * expire after 24 hours. Independent tombstones retry object deletion for a day. */
export const SCRATCH_RECOVERY_MS=3600000,ABANDONED_UPLOAD_MS=86400000;
export class MediaCleanup {
 constructor(private db:Database,private bucket?:R2Bucket){}
 async sweep(now=new Date(),limit=20){
  if(!this.bucket)return {media:0,attempts:0,retried:0};
  const result={media:0,attempts:0,retried:0},lease=crypto.randomUUID(),time=now.toISOString();
  const rows=await this.db.transaction(async client=>{
   const claimed=(await client.query(`SELECT m.* FROM app.run_media m WHERE (lease_id IS NULL OR lease_expires_at<$1) AND (cleanup_next_at IS NULL OR cleanup_next_at<=$1)
    AND (state='deleting' OR state IN ('pending','uploading','ready') AND
      NOT EXISTS(SELECT 1 FROM app.run_media_links l JOIN app.runs r ON r.tenant_id=l.tenant_id AND r.id=l.run_id
       WHERE l.tenant_id=m.tenant_id AND l.media_id=m.id AND (l.role IN ('input','result') OR r.state NOT IN ('succeeded','failed','stopped') OR r.updated_at>$1::timestamptz-interval '1 hour'))
      AND (first_linked_at IS NOT NULL OR updated_at<$1::timestamptz-interval '24 hours'))
    ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT $2`,[time,limit])).rows;
   for(const row of claimed){
    await client.query("UPDATE app.run_media SET state='deleting',lease_id=$3,lease_expires_at=$4::timestamptz+interval '5 minutes',cleanup_attempt=cleanup_attempt+1,updated_at=$4 WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,lease,time]);
    await client.query("DELETE FROM app.run_media_links WHERE tenant_id=$1 AND media_id=$2",[row.tenant_id,row.id]);
   }return claimed;
  });
  for(const row of rows){try{
   if(row.object_key)await this.bucket.delete(row.object_key);
   await this.db.transaction(async client=>{
    const done=await client.query("UPDATE app.run_media SET state='deleted',lease_id=NULL,lease_expires_at=NULL,cleanup_error=NULL,deleted_at=$4,updated_at=$4 WHERE tenant_id=$1 AND id=$2 AND lease_id=$3 RETURNING id",[row.tenant_id,row.id,lease,time]);
    if(!done.rowCount)throw new Error("Media cleanup lease was replaced.");
    await client.query("UPDATE app.media_upload_attempts SET state='cleanup',expires_at=least(expires_at,$3),cleanup_next_at=NULL,updated_at=$3 WHERE tenant_id=$1 AND media_id=$2 AND state='adopted'",[row.tenant_id,row.id,time]);
   });result.media++;
  }catch{
   result.retried++;await this.db.pool.query("UPDATE app.run_media SET lease_id=NULL,lease_expires_at=NULL,cleanup_error='Artifact storage did not confirm deletion',cleanup_next_at=$4::timestamptz+interval '1 minute',updated_at=$4 WHERE tenant_id=$1 AND id=$2 AND lease_id=$3",[row.tenant_id,row.id,lease,time]);
  }}
  const attempts=await this.db.transaction(async client=>{
   const rows=(await client.query(`SELECT a.* FROM app.media_upload_attempts a WHERE
    (cleanup_lease_id IS NULL OR cleanup_lease_expires_at<$1) AND (cleanup_next_at IS NULL OR cleanup_next_at<=$1)
    AND ((state IN ('writing','cleanup') AND expires_at<=$1 AND NOT EXISTS(SELECT 1 FROM app.run_media m WHERE m.tenant_id=a.tenant_id AND m.id=a.media_id AND m.lease_id=a.id AND m.lease_expires_at>$1)) OR state='deleted')
    ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`,[time,limit])).rows;
   for(const row of rows)await client.query("UPDATE app.media_upload_attempts SET cleanup_lease_id=$4,cleanup_lease_expires_at=$5::timestamptz+interval '5 minutes' WHERE tenant_id=$1 AND media_id=$2 AND id=$3",[row.tenant_id,row.media_id,row.id,lease,time]);return rows;
  });
  for(const row of attempts){try{
   await this.bucket.delete(row.object_key);
   if(row.deleted_at && new Date(row.deleted_at).getTime()<=now.getTime()-ABANDONED_UPLOAD_MS)await this.db.pool.query("DELETE FROM app.media_upload_attempts WHERE tenant_id=$1 AND media_id=$2 AND id=$3 AND cleanup_lease_id=$4",[row.tenant_id,row.media_id,row.id,lease]);
   else await this.db.pool.query("UPDATE app.media_upload_attempts SET state='deleted',cleanup_lease_id=NULL,cleanup_lease_expires_at=NULL,cleanup_error=NULL,deleted_at=coalesce(deleted_at,$5),cleanup_next_at=$5::timestamptz+interval '1 hour',updated_at=$5 WHERE tenant_id=$1 AND media_id=$2 AND id=$3 AND cleanup_lease_id=$4",[row.tenant_id,row.media_id,row.id,lease,time]);
   result.attempts++;
  }catch{result.retried++;await this.db.pool.query("UPDATE app.media_upload_attempts SET cleanup_lease_id=NULL,cleanup_lease_expires_at=NULL,cleanup_error='Artifact storage did not confirm deletion',cleanup_next_at=$5::timestamptz+interval '1 minute' WHERE tenant_id=$1 AND media_id=$2 AND id=$3 AND cleanup_lease_id=$4",[row.tenant_id,row.media_id,row.id,lease,time]);}}
  // Receipts outlive object deletion, allowing retries of ambiguous/late puts.
  await this.db.pool.query("DELETE FROM app.run_media m WHERE state='deleted' AND deleted_at<$1::timestamptz-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM app.media_upload_attempts a WHERE a.tenant_id=m.tenant_id AND a.media_id=m.id)",[time]);
  return result;
 }
}
