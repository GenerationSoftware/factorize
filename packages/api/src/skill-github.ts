import { githubHeaders } from "./github";
import {
  validateLibrary,
  SKILL_LIBRARY_BYTES,
  SKILL_LIBRARY_ENTRIES,
  bodyOf,
  validPath,
  type Directory,
} from "./skill-files";
import { SkillConflict } from "./postgres/skill-repository";
import { SKILL_KEY } from "./skills";

type Entry = { path: string; type: string; mode: string; sha: string; size?: number };
type Tree = { tree: Entry[]; truncated: boolean };
type Change = { path: string; mode: string; type: "blob"; sha: string | null };

async function blobId(content: string) {
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  const header = new TextEncoder().encode("blob " + bytes.length + "\0");
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", object)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Git Data reads pin every tree and blob to the observed commit. A large project
 * can share its skills folder without cloning the rest of its working tree. */
export class GitHubSkills {
  head: string | null = null;
  private root = "";
  constructor(
    private base: string,
    private token: string,
    private branch: string,
  ) {}
  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const result = await fetch(this.base + path, {
      method,
      headers: githubHeaders(this.token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok)
      throw new SkillConflict(
        "GitHub " +
          method +
          " failed (" +
          result.status +
          "). Check repository access, branch protection, and the current branch head.",
      );
    return result.json() as Promise<T>;
  }
  async open() {
    const ref = await this.request<{ object: { sha: string } }>(
      "/git/ref/heads/" + this.branch.split("/").map(encodeURIComponent).join("/"),
    );
    this.head = ref.object.sha;
  }
  folderTree: string | null = null;
  private resolvedFolder?: string;
  async resolveFolder(folder: string) {
    if (this.resolvedFolder === folder) return this.folderTree;

    const commit = await this.request<{ tree: { sha: string } }>("/git/commits/" + this.head);
    this.root = commit.tree.sha;
    let oid = this.root;
    for (const part of folder.split("/").filter(Boolean)) {
      const tree = await this.request<Tree>("/git/trees/" + oid);
      if (tree.truncated) throw new SkillConflict("GitHub truncated the directory listing");
      const dir = tree.tree.find((entry) => entry.path === part);
      if (!dir) {
        this.resolvedFolder = folder;
        this.folderTree = null;
        return null;
      }
      if (dir.type !== "tree") throw new SkillConflict("The tracked GitHub skills folder does not exist");
      oid = dir.sha;
    }
    this.resolvedFolder = folder;
    this.folderTree = oid;
    return oid;
  }
  private async entries(folder: string) {
    const oid = await this.resolveFolder(folder);
    if (!oid) return [];
    const tree = await this.request<Tree>("/git/trees/" + oid + "?recursive=1");
    if (tree.truncated || tree.tree.length > SKILL_LIBRARY_ENTRIES)
      throw new SkillConflict("The GitHub skills folder exceeds 2000 entries");
    const keys = tree.tree.filter((entry) => !entry.path.includes("/") && entry.type === "tree");
    if (
      keys.some(
        (key) => !tree.tree.some((entry) => entry.path === key.path + "/SKILL.md" && entry.type === "blob"),
      )
    )
      throw new SkillConflict("Each skill directory needs a SKILL.md file");
    const entries = tree.tree.filter((entry) => entry.path.includes("/") && entry.type !== "tree");
    if (
      entries.some(
        (entry) =>
          !validPath(entry.path) ||
          !SKILL_KEY.test(entry.path.split("/")[0]) ||
          !["100644", "100755"].includes(entry.mode) ||
          entry.type !== "blob" ||
          typeof entry.size !== "number",
      )
    )
      throw new SkillConflict("The GitHub skills folder contains an unsupported path or file type");
    if (entries.reduce((size, file) => size + file.size!, 0) > SKILL_LIBRARY_BYTES)
      throw new SkillConflict("The GitHub skills folder exceeds 8 MiB");
    return entries;
  }
  async directories(folder: string, previous: Directory[] = []) {
    const cached = new Map<string, string>();
    for (const dir of previous)
      for (const file of dir.files) cached.set(await blobId(file.content), file.content);
    const entries = await this.entries(folder);
    const dirs = new Map<string, Directory>();
    for (let i = 0; i < entries.length; i += 6) {
      const files = await Promise.all(
        entries.slice(i, i + 6).map(async (entry) => {
          let content = cached.get(entry.sha);
          if (content === undefined) {
            const blob = await this.request<{ encoding: string; content: string }>("/git/blobs/" + entry.sha);
            if (blob.encoding !== "base64")
              throw new SkillConflict("GitHub returned an unsupported blob encoding");
            content = blob.content.replace(/\s/g, "");
          }
          const [key, ...path] = entry.path.split("/");
          return {
            key,
            file: {
              path: path.join("/"),
              executable: entry.mode === "100755",
              content,
            },
          };
        }),
      );
      for (const { key, file } of files) {
        const dir = dirs.get(key) ?? { key, files: [] };
        dir.files.push(file);
        dirs.set(key, dir);
      }
    }
    for (const dir of dirs.values()) bodyOf(dir);
    return [...dirs.values()];
  }
  async write(folder: string, dirs: Directory[], message: string) {
    validateLibrary(dirs);
    const existing = new Map((await this.entries(folder)).map((entry) => [entry.path, entry]));
    const changes: Change[] = [];
    const prefix = folder ? folder + "/" : "";
    for (const dir of dirs)
      for (const file of dir.files) {
        const path = dir.key + "/" + file.path;
        const old = existing.get(path);
        existing.delete(path);
        const oid = await blobId(file.content);
        const mode = file.executable ? "100755" : "100644";
        if (old?.sha === oid && old.mode === mode) continue;
        const blob = await this.request<{ sha: string }>("/git/blobs", "POST", {
          encoding: "base64",
          content: file.content,
        });
        changes.push({ path: prefix + path, mode, type: "blob", sha: blob.sha });
      }
    for (const entry of existing.values())
      changes.push({ path: prefix + entry.path, mode: entry.mode, type: "blob", sha: null });
    if (!changes.length) return this.head!;
    const tree = await this.request<{ sha: string }>("/git/trees", "POST", {
      base_tree: this.root,
      tree: changes,
    });
    const commit = await this.request<{ sha: string }>("/git/commits", "POST", {
      tree: tree.sha,
      parents: [this.head],
      message,
    });
    await this.request(
      "/git/refs/heads/" + this.branch.split("/").map(encodeURIComponent).join("/"),
      "PATCH",
      { sha: commit.sha, force: false },
    );
    return commit.sha;
  }
}
