import { SkillContent, repositoryToken, type ArtifactVersion } from "./skill-content";
import { decrypt } from "./crypto";
import { githubHeaders, installationToken } from "./github";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { SkillConflict, SkillRepository } from "./postgres/skill-repository";
import { SkillContentError, bodyOf, markdown, type Directory, type SkillVersion } from "./skill-files";
import { withSkillGit, type GitRemote } from "./skill-git";
import { GitHubSkills } from "./skill-github";
import { librarySource, type LibrarySource } from "./skill-library-contract";
import type { Env } from "./types";

type LibraryRow = {
  repo: string;
  remote: string;
  source: LibrarySource;
  commit_sha: string | null;
  upstream_sha: string | null;
  error: string | null;
  github_tree: string | null;
};
type Current = Directory & { id: string; body: string; version?: SkillVersion; ref?: ArtifactVersion };
function fingerprint(dir: Directory) {
  return JSON.stringify(
    dir.files
      .map((f) => [f.path, f.content, f.executable])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}
function sameLibrary(left: Directory[], right: Directory[]) {
  const files = new Map(right.map((dir) => [dir.key, fingerprint(dir)]));
  return left.length === right.length && left.every((dir) => files.get(dir.key) === fingerprint(dir));
}
const managedFolder = "skills";

export class SkillLibrary {
  private db;
  constructor(
    private env: Env,
    private tenant: string,
  ) {
    this.db = databaseFor(env);
  }
  private async locked<T>(work: (client: DatabaseClient, row?: LibraryRow) => Promise<T>) {
    return this.db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [this.tenant]);
      return work(client, await this.row(client));
    });
  }
  private async row(client: DatabaseClient) {
    return (
      await client.query<LibraryRow>("SELECT * FROM app.skill_libraries WHERE tenant_id=$1", [this.tenant])
    ).rows[0];
  }
  private async ensureMigrated() {
    const pending = await this.db.pool.query("SELECT 1 FROM app.skill_library_backfill WHERE tenant_id=$1", [
      this.tenant,
    ]);
    if (pending.rowCount) await this.migrate();
  }
  async status() {
    if (this.env.SKILL_ARTIFACTS) await this.ensureMigrated();
    const row = await this.row(this.db.pool);
    return {
      source: row?.source ?? null,
      remote: row?.remote ?? null,
      commit: row?.commit_sha ?? null,
      upstreamCommit: row?.upstream_sha ?? null,
      error: row?.error ?? null,
    };
  }
  private artifacts() {
    if (!this.env.SKILL_ARTIFACTS) throw new Error("Skill Artifacts binding is unavailable");
    return this.env.SKILL_ARTIFACTS;
  }
  private async credentials(row: LibraryRow, scope: "read" | "write") {
    return repositoryToken(this.artifacts(), row.repo, scope);
  }
  async token() {
    await this.ensureMigrated();
    return this.locked(async (_client, row) => {
      if (!row) throw new SkillConflict("Skill repository is unavailable");
      const token = await this.credentials(row, row.source.kind === "managed" ? "write" : "read");
      return { remote: row.remote, token: token.plaintext, expiresAt: token.expiresAt };
    });
  }
  private async managed(row: LibraryRow, scope: "read" | "write"): Promise<GitRemote> {
    const token = await this.credentials(row, scope);
    return { url: row.remote, branch: "main", headers: { Authorization: "Bearer " + token.plaintext } };
  }
  private async github(client: DatabaseClient, source: Extract<LibrarySource, { kind: "github" }>) {
    const installation = await client.query(
      "SELECT 1 FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2 AND state='active' FOR SHARE",
      [this.tenant, source.installationId],
    );
    if (!installation.rowCount) throw new SkillConflict("GitHub installation is unavailable");
    const token = await installationToken(this.env, source.installationId, source.repositoryId);
    const response = await fetch("https://api.github.com/repositories/" + source.repositoryId, {
      headers: githubHeaders(token),
    });
    if (!response.ok) throw new SkillConflict("GitHub repository is unavailable to this installation");
    const repo = (await response.json()) as { id: number; full_name: string };
    if (repo.id !== source.repositoryId || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name))
      throw new Error("Invalid GitHub repository");
    const repoClient = new GitHubSkills(
      "https://api.github.com/repos/" + repo.full_name,
      token,
      source.branch,
    );
    await repoClient.open();
    return repoClient;
  }
  private async current(client: DatabaseClient, edits?: Map<string, string>): Promise<Current[]> {
    const { rows } = await client.query(
      "SELECT id,key,encrypted_body,encrypted_directory,artifact_version FROM app.skills WHERE tenant_id=$1 ORDER BY key FOR UPDATE",
      [this.tenant],
    );
    const content = new SkillContent(this.env.SKILL_ARTIFACTS);
    return Promise.all(
      rows.map(async (row) => {
        const { body, version } = await content.read(
          row,
          (value) => decrypt(value, this.env.CREDENTIAL_ENCRYPTION_KEY),
          edits?.get(row.id),
        );
        if (
          !row.artifact_version &&
          version &&
          !edits?.has(row.id) &&
          bodyOf({ key: row.key, files: version.files }) !== body
        )
          throw new SkillConflict("Legacy skill body differs from its saved directory");
        return {
          id: row.id,
          key: row.key,
          body,
          version,
          files: version?.files ?? [markdown(body)],
          ref: row.artifact_version,
        };
      }),
    );
  }
  async configure(source: LibrarySource, confirmed = false) {
    if (source.kind === "managed" || confirmed) await this.ensureMigrated();
    await this.locked(async (client, previous) => {
      if (previous && JSON.stringify(librarySource.parse(previous.source)) === JSON.stringify(source)) return;
      if (source.kind === "github" && !confirmed)
        throw new SkillConflict("Confirm replacement of the active skill library.");
      await this.initialize(client, source);
    });
    return this.status();
  }
  private async initialize(client: DatabaseClient, source: LibrarySource) {
    const name = "skills-" + crypto.randomUUID();
    const current = await this.current(client);
    let directories: Directory[] = current;
    let upstreamCommit: string | null = null;
    let tree: string | null = null;
    if (source.kind === "github") {
      const github = await this.github(client, source);
      directories = await github.directories(source.folder);
      upstreamCommit = github.head;
      tree = github.folderTree;
    }
    const created = await this.artifacts().create(name, { setDefaultBranch: "main" });
    const remote: GitRemote = {
      url: created.remote,
      branch: "main",
      headers: { Authorization: "Bearer " + created.token },
    };
    let commit: string;
    try {
      commit = await withSkillGit(remote, (repo) =>
        repo.write(managedFolder, directories, "Initialize Factorize skills"),
      );
      const checked = await withSkillGit({ ...remote, commit }, (repo) => repo.directories(managedFolder));
      if (!sameLibrary(directories, checked)) throw new SkillConflict("Artifacts verification failed");
      await client.query(
        `INSERT INTO app.skill_libraries(tenant_id,repo,remote,source) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id) DO UPDATE SET repo=excluded.repo,remote=excluded.remote,source=excluded.source`,
        [this.tenant, name, created.remote, source],
      );
      await this.publish(client, current, directories, commit, upstreamCommit ?? commit, tree);
    } catch (error) {
      await this.artifacts().delete(name);
      throw error;
    }
  }
  private async publish(
    client: DatabaseClient,
    current: Current[],
    dirs: Directory[],
    revision: string | (() => Promise<string>),
    upstream: string,
    tree: string | null = null,
  ) {
    const keys = new Set(dirs.map((dir) => dir.key));
    const previousByKey = new Map(current.map((item) => [item.key, item]));
    const added = dirs.filter((dir) => !previousByKey.has(dir.key));
    const removed = current.filter((item) => !keys.has(item.key));
    const addedPrints = added.map((dir) => ({ dir, print: fingerprint(dir) }));
    const removedPrints = removed.map((dir) => ({ dir, print: fingerprint(dir) }));
    for (const { dir: item, print } of removedPrints) {
      const matches = addedPrints.filter((candidate) => candidate.print === print);
      if (
        matches.length === 1 &&
        removedPrints.filter((candidate) => candidate.print === print).length === 1
      ) {
        const key = matches[0].dir.key;
        await client.query("UPDATE app.skills SET key=$3, revision=revision+1 WHERE tenant_id=$1 AND id=$2", [
          this.tenant,
          item.id,
          key,
        ]);
        previousByKey.set(key, item);
        continue;
      }
      await client.query("DELETE FROM app.job_skills WHERE tenant_id=$1 AND skill_id=$2", [
        this.tenant,
        item.id,
      ]);
      await client.query(
        "UPDATE app.jobs SET execution_config=execution_config-'launchSkillId',updated_at=now() WHERE tenant_id=$1 AND execution_config->>'launchSkillId'=$2",
        [this.tenant, item.id],
      );
      await client.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2", [this.tenant, item.id]);
    }
    const commit = typeof revision === "string" ? revision : await revision();
    const row = (await this.row(client))!;
    for (const dir of dirs) {
      const previous = previousByKey.get(dir.key);
      const same = previous && fingerprint(dir) === fingerprint(previous);
      if (
        same &&
        previous.ref?.commit === commit &&
        previous.ref.repo === row.repo &&
        previous.ref.key === dir.key
      )
        continue;
      const pointer: ArtifactVersion = { repo: row.repo, remote: row.remote, commit, key: dir.key };
      await client.query(
        `INSERT INTO app.skills(tenant_id,id,key,artifact_version) VALUES($1,$2,$3,$4)
         ON CONFLICT(tenant_id,key) DO UPDATE SET encrypted_body=NULL,encrypted_directory=NULL,artifact_version=excluded.artifact_version,
         revision=app.skills.revision+$5,updated_at=CASE WHEN $5=0 THEN app.skills.updated_at ELSE now() END`,
        [this.tenant, previous?.id ?? crypto.randomUUID(), dir.key, pointer, same ? 0 : 1],
      );
    }
    await client.query(
      "UPDATE app.skill_libraries SET commit_sha=$2,upstream_sha=$3,github_tree=$4,error=NULL,checked_at=now() WHERE tenant_id=$1",
      [this.tenant, commit, upstream, tree],
    );
  }

  async migrate() {
    await this.locked(async (client, row) => {
      const pending = await client.query("SELECT 1 FROM app.skill_library_backfill WHERE tenant_id=$1", [
        this.tenant,
      ]);
      if (!pending.rowCount) return;
      if (!row) await this.initialize(client, { kind: "managed" });
      else {
        const legacy = await this.current(client);
        const remote = await this.managed(row, "read");
        if (!row.commit_sha) throw new SkillConflict("Library has no published commit");
        const stored = await withSkillGit({ ...remote, commit: row.commit_sha }, (repo) =>
          repo.directories(managedFolder),
        );
        if (!sameLibrary(legacy, stored))
          throw new SkillConflict("Stored skills differ from published Artifacts commit");
        await this.publish(
          client,
          legacy,
          stored,
          row.commit_sha,
          row.upstream_sha ?? row.commit_sha,
          row.github_tree,
        );
      }
      await client.query("DELETE FROM app.skill_library_backfill WHERE tenant_id=$1", [this.tenant]);
    });
  }
  async sync(match?: { repo?: string; installationId?: number; repositoryId?: number; ref?: string }) {
    if (this.env.SKILL_ARTIFACTS) await this.ensureMigrated();
    await this.locked(async (client, row) => {
      if (!row) return;
      const source = row.source;
      if (match?.repo && (source.kind !== "managed" || row.repo !== match.repo)) return;
      if (
        match?.installationId &&
        (source.kind !== "github" ||
          source.installationId !== match.installationId ||
          source.repositoryId !== match.repositoryId ||
          match.ref !== "refs/heads/" + source.branch)
      )
        return;
      await client.query("SAVEPOINT skill_sync");
      try {
        const reconcile = async (repo: Pick<GitHubSkills, "head" | "directories">) => {
          if (!repo.head) throw new SkillConflict("The tracked branch is empty");
          if (repo.head === row.upstream_sha) {
            await client.query(
              "UPDATE app.skill_libraries SET error=NULL,checked_at=now() WHERE tenant_id=$1",
              [this.tenant],
            );
            return;
          }
          let tree: string | null = null;
          if (repo instanceof GitHubSkills && source.kind === "github") {
            tree = await repo.resolveFolder(source.folder);
            if (tree === row.github_tree && row.github_tree !== null) {
              await client.query(
                "UPDATE app.skill_libraries SET upstream_sha=$2,checked_at=now(),error=NULL WHERE tenant_id=$1",
                [this.tenant, repo.head],
              );
              return;
            }
          }
          const current = await this.current(client);
          const dirs = await repo.directories(
            source.kind === "managed" ? managedFolder : source.folder,
            current,
          );
          const head = repo.head;
          const mirror = () =>
            this.managed(row, "write").then((remote) =>
              withSkillGit(remote, (repo) => repo.write(managedFolder, dirs, "Sync GitHub " + head)),
            );
          await this.publish(client, current, dirs, source.kind === "managed" ? head : mirror, head, tree);
        };
        if (source.kind === "managed") await withSkillGit(await this.managed(row, "read"), reconcile);
        else await reconcile(await this.github(client, source));
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT skill_sync");
        // Git transport errors can contain credentials. Only surface known local validation messages.
        const message =
          error instanceof SkillConflict || error instanceof SkillContentError
            ? error.message
            : "Sync failed. Check the tracked branch, skill directories, repository limits, and installation access.";
        await client.query("UPDATE app.skill_libraries SET error=$2,checked_at=now() WHERE tenant_id=$1", [
          this.tenant,
          message,
        ]);
      }
    });
  }

  async edit<T>(work: (repository: SkillRepository) => Promise<T>) {
    // Commit the migration separately. Even a rejected first edit leaves a valid baseline.
    this.artifacts();
    await this.ensureMigrated();
    return this.locked(async (client, row) => {
      if (!row) throw new Error("Missing native skill library");
      const edits = new Map<string, string>();
      const store = new SkillRepository(
        this.db,
        this.tenant,
        this.env.CREDENTIAL_ENCRYPTION_KEY,
        client,
        new SkillContent(this.env.SKILL_ARTIFACTS),
        edits,
      );
      const result = await work(store);
      if (!result) return result;
      const after = await this.current(client, edits);
      for (const dir of after) {
        dir.files = dir.files.map((file) =>
          file.path === "SKILL.md" ? { ...markdown(dir.body), executable: file.executable } : file,
        );
      }
      const source = row.source;
      const write = async (repo: Pick<GitHubSkills, "head" | "write">) => {
        if (repo.head !== row.upstream_sha)
          throw new SkillConflict("The repository changed. Sync before editing.");
        return repo.write(
          source.kind === "managed" ? managedFolder : source.folder,
          after,
          "Update Factorize skills",
        );
      };
      const upstream =
        source.kind === "managed"
          ? await withSkillGit(await this.managed(row, "write"), write)
          : await write(await this.github(client, source));
      const commit =
        source.kind === "managed"
          ? upstream
          : await withSkillGit(await this.managed(row, "write"), (repo) =>
              repo.write(managedFolder, after, "Sync GitHub " + upstream),
            );
      for (const dir of after) {
        const pointer: ArtifactVersion = { repo: row.repo, remote: row.remote, commit, key: dir.key };
        await client.query(
          "UPDATE app.skills SET artifact_version=$3,encrypted_directory=NULL,encrypted_body=NULL WHERE tenant_id=$1 AND id=$2",
          [this.tenant, dir.id, pointer],
        );
      }
      await client.query(
        "UPDATE app.skill_libraries SET commit_sha=$2,upstream_sha=$3,github_tree=NULL,error=NULL,checked_at=now() WHERE tenant_id=$1",
        [this.tenant, commit, upstream],
      );
      return result;
    });
  }
}
