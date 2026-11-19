import { vi } from "vitest";
import type { Env } from "../../src/types";
import { withSkillGit } from "../../src/skill-git";
import type { Directory } from "../../src/skill-files";

// These API/browser fixtures exercise the Worker with a request-local Artifacts stand-in.
export function installSkillArtifacts(env: Env) {
  const heads = new Map<string, string>();
  const versions = new Map<string, Directory[]>();
  env.SKILL_ARTIFACTS = {
    async create(name: string) {
      return { remote: "https://git.test/" + name, token: "fixture" };
    },
    async get() {
      return { createToken: async () => ({ plaintext: "fixture" }) };
    },
  } as unknown as Env["SKILL_ARTIFACTS"];
  vi.mocked(withSkillGit).mockImplementation(async (remote, work) => {
    const head = remote.commit ?? heads.get(remote.url);
    return work({
      head: head ?? null,
      directories: async () => structuredClone(versions.get(head!) ?? []),
      write: async (_folder: string, dirs: Directory[]) => {
        const commit = crypto.randomUUID();
        heads.set(remote.url, commit);
        versions.set(commit, structuredClone(dirs));
        return commit;
      },
    });
  });
}
