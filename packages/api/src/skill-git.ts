import fs from "node:fs";
import { Buffer } from "node:buffer";
import git, { type TreeEntry } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import {
  SkillContentError,
  validateLibrary,
  SKILL_LIBRARY_BYTES,
  SKILL_LIBRARY_ENTRIES,
  base64,
  bodyOf,
  validPath,
  type Directory,
  type SkillFile,
} from "./skill-files";
import { SKILL_KEY } from "./skills";

export type GitRemote = { url: string; branch: string; commit?: string; headers: Record<string, string> };
const author = { name: "Factorize", email: "skills@factorize.sh" };

// Bound the shallow pack as well as the uncompressed skills copied into the launch payload.
const transport: typeof http = {
  async request(options) {
    const result = await http.request(options);
    const stream = result.body;
    if (!stream) return result;
    async function* bounded() {
      let total = 0;
      for await (const bytes of stream!) {
        total += bytes.byteLength;
        if (total > 16 * 1024 * 1024)
          throw new SkillContentError("Skill repository exceeds the shallow fetch limit");
        yield bytes;
      }
    }
    return { ...result, body: bounded() };
  },
};

export async function withSkillGit<T>(
  remote: GitRemote,
  work: (repo: Pick<SkillGit, "head" | "directories" | "write">) => Promise<T>,
) {
  const root = await fs.promises.mkdtemp("/tmp/factorize-skills-");
  try {
    const repo = new SkillGit(root, remote);
    await repo.open();
    return await work(repo);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

export class SkillGit {
  private options;
  private network;
  private pinned?: string;
  head: string | null = null;
  private tree: string | null = null;
  constructor(dir: string, remote: GitRemote) {
    this.options = { fs, dir };
    this.pinned = remote.commit;
    this.network = {
      ...this.options,
      http: transport,
      url: remote.url,
      ref: remote.branch,
      headers: remote.headers,
    };
  }
  async open() {
    if (this.pinned) {
      this.head = this.pinned;
      return;
    }
    const refs = await git.listServerRefs({
      ...this.network,
      headers: { ...this.network.headers },
      prefix: "refs/heads/",
    });
    const ref = refs.find((ref) => ref.ref === "refs/heads/" + this.network.ref);
    if (!ref) {
      if (refs.some((ref) => ref.ref.startsWith("refs/heads/")))
        throw new SkillContentError("Tracked branch does not exist");
      return;
    }
    this.head = ref.oid;
  }
  private async load() {
    if (this.tree) return;
    await git.init({ ...this.options, defaultBranch: this.network.ref });
    await git.addRemote({ ...this.options, remote: "origin", url: this.network.url });
    if (!this.head) return;
    const result = await git.fetch({
      ...this.network,
      headers: { ...this.network.headers },
      remoteRef: this.pinned ?? this.network.ref,
      singleBranch: true,
      depth: 1,
      tags: false,
    });
    if (!result.fetchHead) throw new SkillContentError("Unable to fetch skills branch");
    if (this.head !== result.fetchHead)
      throw new SkillContentError("Tracked branch changed during synchronization");
    this.tree = (await git.readCommit({ ...this.options, oid: this.head })).commit.tree;
  }
  private async entries(oid: string | null) {
    return oid ? (await git.readTree({ ...this.options, oid })).tree : [];
  }
  async directories(folder: string) {
    await this.load();
    let tree = this.tree;
    for (const part of folder.split("/").filter(Boolean)) {
      const entry = (await this.entries(tree)).find((entry) => entry.path === part);
      if (entry && entry.type !== "tree") throw new SkillContentError("Skills folder must be a directory");
      tree = entry?.oid ?? null;
    }
    const directories: Directory[] = [];
    let count = 0,
      size = 0;
    const visit = async (oid: string, prefix: string, files: SkillFile[]) => {
      for (const entry of await this.entries(oid)) {
        const path = prefix + entry.path;
        if (++count > SKILL_LIBRARY_ENTRIES || !validPath(path))
          throw new SkillContentError("Unsupported skill directory size or path");
        if (entry.type === "tree") {
          await visit(entry.oid, path + "/", files);
          continue;
        }
        if (!["100644", "100755"].includes(entry.mode))
          throw new SkillContentError("Skills may contain only regular files and directories");
        const { blob } = await git.readBlob({ ...this.options, oid: entry.oid });
        size += blob.length;
        if (size > SKILL_LIBRARY_BYTES) throw new SkillContentError("Skills exceed the 8 MiB library limit");
        files.push({ path, content: base64(blob), executable: entry.mode === "100755" });
      }
    };
    for (const entry of await this.entries(tree)) {
      if (entry.type !== "tree") continue;
      if (!SKILL_KEY.test(entry.path)) throw new SkillContentError("Invalid skill directory name");
      const directory: Directory = { key: entry.path, files: [] };
      await visit(entry.oid, "", directory.files);
      bodyOf(directory);
      directories.push(directory);
    }
    return directories;
  }
  async write(folder: string, directories: Directory[], message: string) {
    validateLibrary(directories);
    await this.load();
    // Replace only skill directories. Keep unrelated root files and other project paths.
    const replace = async (oid: string | null, parts: string[]): Promise<string> => {
      const entries = await this.entries(oid);
      if (parts.length) {
        const [part, ...rest] = parts;
        const previous = entries.find((entry) => entry.path === part);
        const child = await replace(previous?.oid ?? null, rest);
        return git.writeTree({
          ...this.options,
          tree: [
            ...entries.filter((entry) => entry.path !== part),
            { mode: "040000", type: "tree", path: part, oid: child },
          ],
        });
      }
      if (entries.some((entry) => entry.type !== "tree" && directories.some((dir) => dir.key === entry.path)))
        throw new SkillContentError("A file already uses this skill directory name");
      const files = directories.flatMap((dir) =>
        dir.files.map((file) => ({ ...file, path: dir.key + "/" + file.path })),
      );
      const build = async (items: SkillFile[], retained: TreeEntry[] = []): Promise<string> => {
        const children = new Map<string, SkillFile[]>();
        const tree = [...retained];
        for (const file of items) {
          const slash = file.path.indexOf("/");
          if (slash === -1) {
            tree.push({
              path: file.path,
              mode: file.executable ? "100755" : "100644",
              type: "blob",
              oid: await git.writeBlob({ ...this.options, blob: Buffer.from(file.content, "base64") }),
            });
          } else {
            const name = file.path.slice(0, slash);
            const group = children.get(name) ?? [];
            group.push({ ...file, path: file.path.slice(slash + 1) });
            children.set(name, group);
          }
        }
        for (const [path, group] of children)
          tree.push({ path, mode: "040000", type: "tree", oid: await build(group) });
        return git.writeTree({ ...this.options, tree });
      };
      return build(
        files,
        entries.filter((entry) => entry.type !== "tree"),
      );
    };
    const tree = await replace(this.tree, folder.split("/").filter(Boolean));
    if (this.head && tree === this.tree) return this.head;
    const oid = await git.commit({
      ...this.options,
      tree,
      parent: this.head ? [this.head] : [],
      author,
      message,
      ref: this.network.ref,
    });
    await git.push({ ...this.network, remoteRef: this.network.ref });
    this.head = oid;
    this.tree = tree;
    return oid;
  }
}
