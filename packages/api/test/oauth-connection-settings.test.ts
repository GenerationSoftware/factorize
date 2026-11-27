import { describe, expect, it } from "vitest";
import { applyConnectionScopes } from "../src/access-control/application/oauth-connection-settings";

describe("OAuth connection scope policy", () => {
  it("retains separate scope limits for credentials under the same policy", () => {
    const basic = ["fixture:read"];
    const extended = [...basic, "fixture:edit"];
    const expanded = { scope_overrides: extended, disabled_scopes: [] };
    expect(applyConnectionScopes(basic, expanded)).toEqual(basic);
    expect(applyConnectionScopes(extended, expanded)).toEqual(extended);

    const restricted = { scope_overrides: basic, disabled_scopes: [] };
    expect(applyConnectionScopes(basic, restricted)).toEqual(basic);
    expect(applyConnectionScopes(extended, restricted)).toEqual(basic);
  });

  it("honors explicit denials even when the override includes a scope", () => {
    const scopes = ["fixture:read", "fixture:edit"];
    expect(applyConnectionScopes(scopes, {
      scope_overrides: scopes, disabled_scopes: ["fixture:edit"],
    })).toEqual(["fixture:read"]);
    expect(applyConnectionScopes(scopes, {
      scope_overrides: null, disabled_scopes: ["fixture:edit"],
    })).toEqual(["fixture:read"]);
  });

  it("distinguishes an empty allowlist from no override", () => {
    const scopes = ["fixture:read"];
    expect(applyConnectionScopes(scopes)).toEqual(scopes);
    expect(applyConnectionScopes(scopes, { scope_overrides: [], disabled_scopes: [] })).toEqual([]);
    expect(applyConnectionScopes([], { scope_overrides: scopes, disabled_scopes: [] })).toEqual([]);
  });
});
