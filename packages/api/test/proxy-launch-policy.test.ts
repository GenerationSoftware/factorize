import { describe, expect, it } from "vitest";
import { proxyLaunchDecision, ProxyLaunchBlockedError, requireProxyLaunch, type ProxyLaunchJob, type ProxyLaunchState } from "../src/proxy-launch-policy";

const stopped: ProxyLaunchState = { enabled: true, running: false, unlocked: false, pendingChanges: false };
const locked: ProxyLaunchState = { enabled: true, running: true, unlocked: false, pendingChanges: false };
const unlocked: ProxyLaunchState = { enabled: true, running: true, unlocked: true, pendingChanges: false };
const flyCode: ProxyLaunchJob = { executionProvider: "fly", executionType: "code" };

describe("GEN-2824 proxy launch policy", () => {
  it("starts an enabled proxy locked for Fly code jobs with no user credential grants", () => {
    expect(proxyLaunchDecision(flyCode, stopped)).toEqual({ kind: "start_locked" });
  });

  it("allows code-only Factorize access while the proxy is running and locked", () => {
    expect(proxyLaunchDecision(flyCode, locked)).toEqual({ kind: "allow" });
  });

  it.each([
    { label: "portable tools", job: { ...flyCode, portableIntegrationIds: ["integration"] } },
    { label: "portable model account", job: { ...flyCode, executionType: "agent" as const, modelAccess: "portable" as const, modelAccountId: "model" } },
  ])("requires an unlocked proxy with applied updates for $label", ({ job }) => {
    expect(proxyLaunchDecision(job, stopped)).toEqual({ kind: "blocked", reason: "proxy_unavailable", retry: "manual" });
    expect(proxyLaunchDecision(job, locked)).toEqual({ kind: "blocked", reason: "proxy_locked", retry: "manual" });
    expect(proxyLaunchDecision(job, { ...unlocked, pendingChanges: true })).toEqual({ kind: "blocked", reason: "pending_changes", retry: "manual" });
    expect(proxyLaunchDecision(job, unlocked)).toEqual({ kind: "allow" });
  });

  it("never auto-starts a disabled proxy and preserves native exe.dev behavior", () => {
    expect(proxyLaunchDecision(flyCode, { ...stopped, enabled: false })).toEqual({ kind: "blocked", reason: "proxy_disabled", retry: "manual" });
    expect(proxyLaunchDecision({ executionProvider: "exe", executionType: "agent" }, { ...stopped, enabled: false })).toEqual({ kind: "allow" });
  });

  it("does not auto-start a stopped proxy for credential-dependent jobs", () => {
    expect(proxyLaunchDecision({ ...flyCode, portableIntegrationIds: ["integration"] }, stopped)).toMatchObject({ kind: "blocked", retry: "manual" });
  });

  it("turns a blocked decision into a scheduler-recognized launch outcome", () => {
    expect(() => requireProxyLaunch(proxyLaunchDecision({ ...flyCode, portableIntegrationIds: ["integration"] }, locked)))
      .toThrow(new ProxyLaunchBlockedError("proxy_locked"));
    expect(() => requireProxyLaunch(proxyLaunchDecision(flyCode, locked))).not.toThrow();
  });
});
