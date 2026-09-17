import { describe, expect, it } from "vitest";
import { installedTriggerAvailability, sameProviderReference } from "../src/trigger-availability";

describe("job trigger availability", () => {
  it("only offers universal triggers with zero installations", () => {
    expect(installedTriggerAvailability(false, false, [], 0)).toEqual({ manual: true, schedule: true, jobLifecycle: true, linear: false, clickup: false, github: false, cloudflareTail: false });
  });

  it("offers each provider for one matching installation", () => {
    expect(installedTriggerAvailability(true, true, ["active"], 1)).toMatchObject({ linear: true, clickup: true, github: true, cloudflareTail: true });
  });

  it("handles multiple installations without changing the provider result", () => {
    expect(installedTriggerAvailability(true, true, ["active", "active"], 2)).toMatchObject({ github: true, cloudflareTail: true });
  });

  it("ignores disconnected and stale GitHub installations", () => {
    expect(installedTriggerAvailability(false, false, ["removed", "suspended"], 0)).toMatchObject({ linear: false, clickup: false, github: false, cloudflareTail: false });
  });

  it("preserves a stale trigger only when its installation reference is unchanged", () => {
    expect(sameProviderReference({ provider: "github", installationId: 7, repositoryId: 2 }, { provider: "github", installationId: 7, repositoryId: 1 })).toBe(true);
    expect(sameProviderReference({ provider: "github", installationId: 8 }, { provider: "github", installationId: 7 })).toBe(false);
    expect(sameProviderReference({ provider: "cloudflareTail", integrationId: "stale" }, { provider: "cloudflareTail", integrationId: "stale" })).toBe(true);
  });
});
