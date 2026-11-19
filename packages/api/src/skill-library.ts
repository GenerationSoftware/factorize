import { decrypt, encrypt } from "./crypto";
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
};
type Current = Directory & { id: string; body: string; version?: SkillVersion };
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
  async status() {
    const row = await this.row(this.db.pool);
    return {
      source: row?.source ?? null,
      remote: row?.source.kind === "managed" ? row.remote : null,
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
    const handle = await this.artifacts().get(row.repo);
    try {
      return await handle.createToken(scope, 3600);
    } finally {
      (handle as unknown as Partial<Disposable>)[Symbol.dispose]?.();
    }
  }
  async token() {
    const row = await this.row(this.db.pool);
    if (row?.source.kind !== "managed")
      throw new SkillConflict("Select the Factorize-managed Git remote first");
    const token = await this.credentials(row, "write");
    return { remote: row.remote, token: token.plaintext, expiresAt: token.expiresAt };
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
  private async current(client: DatabaseClient): Promise<Current[]> {
    const { rows } = await client.query(
      "SELECT id,key,encrypted_body,encrypted_directory FROM app.skills WHERE tenant_id=$1 ORDER BY key FOR UPDATE",
      [this.tenant],
    );
    return Promise.all(
      rows.map(async (row) => {
        const version: SkillVersion | undefined = row.encrypted_directory
          ? JSON.parse(await decrypt(row.encrypted_directory, this.env.CREDENTIAL_ENCRYPTION_KEY))
          : undefined;
        const body = await decrypt(row.encrypted_body, this.env.CREDENTIAL_ENCRYPTION_KEY);
        return { id: row.id, key: row.key, body, version, files: version?.files ?? [markdown(body)] };
      }),
    );
  }
  async configure(source: LibrarySource) {
    await this.locked((client, previous) => this.initialize(client, source, previous));
    return this.status();
  }
  private async initialize(client: DatabaseClient, source: LibrarySource, previous?: LibraryRow) {
    if (previous && JSON.stringify(librarySource.parse(previous.source)) === JSON.stringify(source)) return;
    // Independent repos prevent an outstanding managed write token from changing a GitHub mirror.
    const name = "skills-" + crypto.randomUUID();
    const current = await this.current(client);
    let directories: Directory[] = current;
    let upstreamCommit: string | null = null;
    if (source.kind === "github") {
      const repo = await this.github(client, source);
      const imported = await repo.directories(source.folder);
      const keys = new Set(imported.map((dir) => dir.key));
      const missing = current.filter((dir) => !keys.has(dir.key));
      directories = [...imported, ...missing];
      // The selected branch supplies existing keys. Seed only absent skills, in one fast-forward commit.
      upstreamCommit = missing.length
        ? await repo.write(source.folder, directories, "Import existing Factorize skills")
        : repo.head;
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
    } catch (error) {
      await this.artifacts().delete(name);
      throw error;
    }
    await client.query(
      `INSERT INTO app.skill_libraries(tenant_id,repo,remote,source) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id) DO UPDATE SET repo=excluded.repo,remote=excluded.remote,source=excluded.source`,
      [this.tenant, name, created.remote, source],
    );
    await this.publish(client, current, directories, commit, upstreamCommit ?? commit);
  }
  private async publish(
    client: DatabaseClient,
    current: Current[],
    dirs: Directory[],
    revision: string | (() => Promise<string>),
    upstream: string,
  ) {
    const keys = new Set(dirs.map((dir) => dir.key));
    const previousByKey = new Map(current.map((item) => [item.key, item]));
    const added = dirs.filter((dir) => !previousByKey.has(dir.key));
    const removed = current.filter((item) => !keys.has(item.key));
    // Git has no rename identity. Preserve an ID only for an unambiguous move of the exact directory.
    const fingerprint = (dir: Directory) =>
      JSON.stringify(
        dir.files
          .map((f) => [f.path, f.content, f.executable])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
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
      if (
        (
          await client.query("SELECT 1 FROM app.job_skills WHERE tenant_id=$1 AND skill_id=$2 LIMIT 1", [
            this.tenant,
            item.id,
          ])
        ).rowCount
      )
        throw new SkillConflict("Cannot remove referenced skill " + item.key);
      await client.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2", [this.tenant, item.id]);
    }
    const commit = typeof revision === "string" ? revision : await revision();
    for (const dir of dirs) {
      const previous = previousByKey.get(dir.key);
      const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
      const same = previous && fingerprint(dir) === fingerprint(previous);
      if (same && previous.version?.commit === commit) continue;
      const encrypted = await encrypt(JSON.stringify({ commit, files }), this.env.CREDENTIAL_ENCRYPTION_KEY);
      await client.query(
        `INSERT INTO app.skills(tenant_id,id,key,encrypted_body,encrypted_directory) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,key) DO UPDATE SET encrypted_body=excluded.encrypted_body,encrypted_directory=excluded.encrypted_directory,
        revision=app.skills.revision+$6,updated_at=now()`,
        [
          this.tenant,
          previous?.id ?? crypto.randomUUID(),
          dir.key,
          await encrypt(bodyOf(dir), this.env.CREDENTIAL_ENCRYPTION_KEY),
          encrypted,
          same ? 0 : 1,
        ],
      );
    }
    await client.query(
      "UPDATE app.skill_libraries SET commit_sha=$2,upstream_sha=$3,error=NULL,checked_at=now() WHERE tenant_id=$1",
      [this.tenant, commit, upstream],
    );
  }
  async sync(match?: { repo?: string; installationId?: number; repositoryId?: number; ref?: string }) {
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
          const current = await this.current(client);
          const dirs = await repo.directories(source.kind === "managed" ? managedFolder : source.folder);
          const head = repo.head;
          const mirror = () =>
            this.managed(row, "write").then((remote) =>
              withSkillGit(remote, (repo) => repo.write(managedFolder, dirs, "Sync GitHub " + head)),
            );
          await this.publish(client, current, dirs, source.kind === "managed" ? head : mirror, head);
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
    if (this.env.SKILL_ARTIFACTS && !(await this.row(this.db.pool)))
      await this.locked(async (client, existing) => {
        if (!existing) await this.initialize(client, { kind: "managed" });
      });
    return this.locked(async (client, row) => {
      const store = new SkillRepository(this.db, this.tenant, this.env.CREDENTIAL_ENCRYPTION_KEY, client);
      const result = await work(store);
      if (!row || !result) return result;
      const after = await this.current(client);
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
        if (dir.version?.commit === commit) continue;
        await client.query("UPDATE app.skills SET encrypted_directory=$3 WHERE tenant_id=$1 AND id=$2", [
          this.tenant,
          dir.id,
          await encrypt(JSON.stringify({ commit, files: dir.files }), this.env.CREDENTIAL_ENCRYPTION_KEY),
        ]);
      }
      await client.query(
        "UPDATE app.skill_libraries SET commit_sha=$2,upstream_sha=$3,error=NULL,checked_at=now() WHERE tenant_id=$1",
        [this.tenant, commit, upstream],
      );
      return result;
    });
  }
}
