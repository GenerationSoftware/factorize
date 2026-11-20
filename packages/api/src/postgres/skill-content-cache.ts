import { encrypt,decrypt } from "../crypto";
import type { Directory } from "../skill-files";
import type { SkillContentCache } from "../skill-content";
import type { Database } from "./database";
/** Published commits are immutable. Tenant-qualified, encrypted rows can serve
 * subsequent requests without retaining Worker sockets or fetching Git again. */
export class PostgresSkillContentCache implements SkillContentCache {
 constructor(private database:Database,private tenant:string,private key:string){}
 async get(repository:string,commit:string):Promise<Directory[]|undefined>{
  const row=(await this.database.pool.query("SELECT encrypted_content FROM app.skill_content_cache WHERE tenant_id=$1 AND repository=$2 AND commit_sha=$3",[this.tenant,repository,commit])).rows[0];
  return row?JSON.parse(await decrypt(row.encrypted_content,this.key)):undefined;
 }
 async put(repository:string,commit:string,content:Directory[]){
  await this.database.pool.query("INSERT INTO app.skill_content_cache(tenant_id,repository,commit_sha,encrypted_content) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[this.tenant,repository,commit,await encrypt(JSON.stringify(content),this.key)]);
 }
}
