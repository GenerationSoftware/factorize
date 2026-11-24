import { describe, expect, it } from "vitest";
import { installedEventAvailability, sameProviderReference } from "../src/trigger-availability";

describe("trigger event availability", () => {
  it("only offers universal events with zero installations", () => {
    expect(installedEventAvailability(false, false, [])).toEqual({ manual: true, schedule: true, linear: false, clickup: false, github: false, cloudflareTail: false });
  });

  it("offers each provider for one matching installation", () => {
    expect(installedEventAvailability(true, true, ["active"])).toMatchObject({ linear: true, clickup: true, github: true, cloudflareTail: false });
  });

  it("handles multiple installations without changing the provider result", () => {
    expect(installedEventAvailability(true, true, ["active", "active"])).toMatchObject({ github: true, cloudflareTail: false });
  });

  it("ignores disconnected and stale GitHub installations", () => {
    expect(installedEventAvailability(false, false, ["removed", "suspended"])).toMatchObject({ linear: false, clickup: false, github: false, cloudflareTail: false });
  });

  it("preserves a stale event only when its installation reference is unchanged", () => {
    expect(sameProviderReference({ provider: "github", installationId: 7, repositoryId: 2 }, { provider: "github", installationId: 7, repositoryId: 1 })).toBe(true);
    expect(sameProviderReference({ provider: "github", installationId: 8 }, { provider: "github", installationId: 7 })).toBe(false);
    expect(sameProviderReference({ provider: "cloudflareTail", integrationId: "stale" }, { provider: "cloudflareTail", integrationId: "stale" })).toBe(true);
  });
});
