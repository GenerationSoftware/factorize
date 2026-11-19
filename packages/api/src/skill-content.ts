import type { Env } from "./types";
import { bodyOf, type Directory, type SkillVersion } from "./skill-files";
import { withSkillGit } from "./skill-git";

export type ArtifactVersion = { repo: string; remote: string; commit: string; key: string };
export type SkillContentRow = {
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

// Request-local only. All skills in one published commit share a shallow Git fetch.
export class SkillContent {
  private versions = new Map<string, Promise<Map<string, Directory>>>();
  constructor(private binding?: Env["SKILL_ARTIFACTS"]) {}
  private async fetch(ref: ArtifactVersion) {
    if (!this.binding) throw new Error("Skill Artifacts binding is unavailable");
    const token = await repositoryToken(this.binding, ref.repo, "read");
    const remote = {
      url: ref.remote,
      branch: "main",
      commit: ref.commit,
      headers: { Authorization: "Bearer " + token.plaintext },
    };
    const directories = await withSkillGit(remote, (repo) => repo.directories("skills"));
    return new Map(directories.map((dir) => [dir.key, dir]));
  }
  async read(row: SkillContentRow, decrypt: (value: string) => Promise<string>, editedBody?: string) {
    const ref = row.artifact_version;
    let version: SkillVersion | undefined;
    if (ref) {
      const cacheKey = ref.repo + ":" + ref.commit;
      let loading = this.versions.get(cacheKey);
      if (!loading) {
        loading = this.fetch(ref);
        this.versions.set(cacheKey, loading);
      }
      const directory = (await loading).get(ref.key);
      if (!directory) throw new Error("Published skill is missing from Artifacts");
      version = { commit: ref.commit, files: directory.files };
      return { body: editedBody ?? bodyOf(directory), version };
    }
    if (!row.encrypted_body && editedBody === undefined) throw new Error("Skill has no published content");
    if (row.encrypted_directory) version = JSON.parse(await decrypt(row.encrypted_directory)) as SkillVersion;
    return { body: editedBody ?? (await decrypt(row.encrypted_body!)), version };
  }
}
