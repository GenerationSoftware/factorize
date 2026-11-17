import pg from 'pg';
import {webcrypto} from 'node:crypto';

// Run against the pre-cutover schema with dispatch AND credential writes paused.
// Default is a read-only plan. It never prints or recovers inner user secrets.
const apply=process.argv.includes('--apply');
if(!process.env.DATABASE_URL || !process.env.CREDENTIAL_ENCRYPTION_KEY)throw new Error('DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY are required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  await client.query('BEGIN');
  await client.query('LOCK TABLE app.job_runs,app.jobs,app.integration_records,app.integration_changes IN ACCESS EXCLUSIVE MODE');
  const active=(await client.query("SELECT count(*)::int AS count FROM app.job_runs WHERE state NOT IN ('succeeded','failed','stopped')")).rows[0].count;
  if(active)throw new Error('Drain all runs and pause dispatch before preparation');
  const key=await webcrypto.subtle.importKey('raw',Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY,'base64'),'AES-GCM',false,['decrypt']);
  const records=(await client.query('SELECT tenant_id,id,kind,encrypted_payload FROM app.integration_records WHERE deleted_at IS NULL')).rows;
  const legacy=[];
  for(const record of records){
    // Decrypt only the existing Factorize envelope. Inner user ciphertext is
    // classified as unavailable; the old user key is neither accepted nor used.
    const [iv,body]=record.encrypted_payload.split('.');
    const plain=new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(body,'base64')));
    const prefix=record.kind==='bearer'?'factorize-managed-bearer-v1:':'factorize-managed-model-cache-v1:';
    if(!plain.startsWith(prefix))legacy.push({tenantId:record.tenant_id,id:record.id,kind:record.kind});
  }
  const proxies=(await client.query('SELECT tenant_id,proxy_identity FROM app.credential_proxy_states ORDER BY tenant_id')).rows;
  const jobs=(await client.query('SELECT tenant_id,id,enabled,execution_config FROM app.jobs ORDER BY tenant_id,id')).rows.map(row=>({tenantId:row.tenant_id,id:row.id,enabled:row.enabled,portableIntegrationIds:row.execution_config.portableIntegrationIds??[],modelAccountId:row.execution_config.modelAccountId??null,requiresRepair:legacy.some(c=>c.tenantId===row.tenant_id && ((row.execution_config.portableIntegrationIds??[]).includes(c.id)||row.execution_config.modelAccountId===c.id))}));
  if(apply){
    for(const job of jobs.filter(j=>j.requiresRepair))await client.query('UPDATE app.jobs SET enabled=false,updated_at=now() WHERE tenant_id=$1 AND id=$2',[job.tenantId,job.id]);
    for(const record of legacy)await client.query('UPDATE app.integration_records SET encrypted_payload=NULL,deleted_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2',[record.tenantId,record.id]);
    for(const tenantId of new Set(legacy.map(r=>r.tenantId)))await client.query('UPDATE app.integration_collections SET revision=revision+1,updated_at=now() WHERE tenant_id=$1',[tenantId]);
    // The removed change-feed protocol is deliberately reset at this breaking
    // boundary. Managed active records are preserved, old ciphertext is erased.
    await client.query('DELETE FROM app.integration_changes');
    await client.query("UPDATE app.credential_proxy_states SET disabled_at=now(),revoked_at=now()");
    await client.query("UPDATE app.credential_proxy_control_credentials SET revoked_at=now()");
    await client.query("UPDATE app.credential_run_grants SET revoked_at=now()");
    await client.query("UPDATE app.credential_run_enrollments SET consumed_at=now()");
    await client.query("INSERT INTO app.schema_migrations(version,applied_at) VALUES('gen_2922_credentials_prepared',now()) ON CONFLICT(version) DO UPDATE SET applied_at=excluded.applied_at");
    await client.query('COMMIT');
  }else await client.query('ROLLBACK');
  console.log(JSON.stringify({mode:apply?'applied':'plan',activeRuns:active,legacyCredentials:legacy,retireProxies:proxies,jobs},null,2));
}catch{
  await client.query('ROLLBACK').catch(()=>{});
  throw new Error('Cutover preparation failed; no changes committed. Check paused dispatch, terminal runs, schema and server encryption key.');
}finally{await client.end();}
