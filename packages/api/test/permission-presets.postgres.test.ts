import { describe, expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { ApiService } from "../src/api-service";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("team permission presets", () => {
  it("creates, edits, lists, and sets a default scope preset", async () => {
    const f = await loadingFixture(url!);
    try {
      const service = new ApiService(f.env,f.auth);
      const created = await service.createPermissionPreset({name:"Read only",scopes:["triggers:read","proxy:use"]});
      expect(created).toMatchObject({name:"Read only",scopes:["triggers:read","proxy:use"],isDefault:false,revision:1});
      await service.setDefaultPermissionPreset(created.id);
      const updated = await service.updatePermissionPreset(created.id,{name:"Agent read",scopes:["triggers:read"],expectedRevision:1});
      expect(updated).toMatchObject({name:"Agent read",scopes:["triggers:read"],isDefault:true,revision:2});
      expect(await service.listPermissionPresets()).toEqual([updated]);
    } finally { await f.cleanup(); }
  });
});
