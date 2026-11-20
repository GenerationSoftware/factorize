import type { Env } from "./types";
import { bodyOf, markdown, validateLibrary, type Directory, type SkillVersion } from "./skill-files";
import { withSkillGit } from "./skill-git";

export type ArtifactVersion = { repo: string; remote: string; commit: string; key: string };
export type SkillContentRow = {
  legacy_context?: (SkillContentRow & {key?:string})[];
  artifact_version?: ArtifactVersion | null;
  encrypted_body?: string | null;
  encrypted_directory?: string | null;
};

export async function repositoryToken(
  binding: NonNullable<Env["SKILL_ARTIFACTS"]>,
  repo: string,
  scope: "read" | "write",
) {
  const handle = await binding.get(repo);
  try {
    return await handle.createToken(scope, 3600);
  } finally {
    (handle as unknown as Partial<Disposable>)[Symbol.dispose]?.();
  }
}

export interface SkillContentCache {get(repository:string,commit:string):Promise<Directory[]|undefined>;put(repository:string,commit:string,content:Directory[]):Promise<void>;}
// Request-local coalescing plus an optional durable cache of immutable commits.
export class SkillContent {
  private versions = new Map<string, Promise<Map<string, Directory>>>();
  constructor(private binding?: Env["SKILL_ARTIFACTS"], private cache?:SkillContentCache) {}
  private async fetch(ref: ArtifactVersion) {
    const repository=JSON.stringify([ref.repo,ref.remote]);
    const cached=await this.cache?.get(repository,ref.commit);
    if(cached){validateLibrary(cached);return new Map(cached.map(dir=>[dir.key,dir]));}
    if (!this.binding) throw new Error("Skill Artifacts binding is unavailable");
    const token = await repositoryToken(this.binding, ref.repo, "read");
    const remote = {
      url: ref.remote,
      branch: "main",
      commit: ref.commit,
      headers: { Authorization: "Bearer " + token.plaintext },
    };
    const directories = await withSkillGit(remote, (repo) => repo.directories("skills"));
    validateLibrary(directories);
    await this.cache?.put(repository,ref.commit,directories);
    return new Map(directories.map((dir) => [dir.key, dir]));
  }
  async read(row: SkillContentRow, decrypt: (value:string)=>Promise<string>, editedBody?:string): Promise<{body:string;version?:SkillVersion}> {
    const base=await this.readBase(row,decrypt,editedBody);
    if(!row.legacy_context?.length)return base;
    const inherited=await Promise.all(row.legacy_context.map(entry=>this.read(entry,decrypt)));
    const body=editedBody??[...inherited.map(entry=>entry.body),base.body].filter(Boolean).join("\n\n");
    const files=[markdown(body),...(base.version?.files??[]).filter(file=>file.path!=="SKILL.md"),...inherited.flatMap((entry,index)=>(entry.version?.files??[markdown(entry.body)]).map(file=>({...file,path:`legacy/${index+1}-${row.legacy_context![index].key??"context"}/${file.path}`})))];
    return {body,version:{commit:base.version?.commit??"migration",files}};
  }
  private async readBase(row: SkillContentRow, decrypt: (value: string) => Promise<string>, editedBody?: string) {
    const ref = row.artifact_version;
    let version: SkillVersion | undefined;
    if (ref) {
      const cacheKey = JSON.stringify([ref.repo,ref.remote,ref.commit]);
      let loading = this.versions.get(cacheKey);
      if (!loading) {
        loading = this.fetch(ref).catch(error=>{this.versions.delete(cacheKey);throw error;});
        this.versions.set(cacheKey, loading);
      }
      const directory = (await loading).get(ref.key);
      if (!directory) throw new Error("Published skill is missing from Artifacts");
      version = { commit: ref.commit, files: directory.files };
      return { body: editedBody ?? bodyOf(directory), version };
    }
    if (row.encrypted_body == null && editedBody === undefined) throw new Error("Skill has no published content");
    if (row.encrypted_directory) version = JSON.parse(await decrypt(row.encrypted_directory)) as SkillVersion;
    return { body: editedBody ?? (row.encrypted_body ? await decrypt(row.encrypted_body) : ""), version };
  }
}
