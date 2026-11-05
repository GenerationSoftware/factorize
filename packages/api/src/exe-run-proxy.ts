import type { BackendCommandResult } from "./execution";
import { shellAtom } from "./exe";
import { runProxyName } from "./run-credentials";

interface Integration { name: string; type: string; comment?: string; help?: string; target?: string; attachments?: unknown[]; }
interface ProxyPlan { name: string; runId: string; exists: boolean; }

// The public CLI serializes time-boxed attachments as spec@RFC3339.
function attachment(value: unknown): { spec: string; expiresAt?: number } {
  if (typeof value !== "string") throw new Error("Unsupported integration attachment");
  const parts = value.split("@"), spec = parts[0];
  if ((spec !== "auto:all" && !/^(?:vm|tag):[A-Za-z0-9._:-]+$/.test(spec)) || parts.length > 2) throw new Error("Unsupported integration attachment");
  if (parts.length === 1) return { spec };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parts[1])) throw new Error("Unsupported integration attachment expiry");
  const expiresAt = Date.parse(parts[1]);
  if (!Number.isFinite(expiresAt)) throw new Error("Unsupported integration attachment expiry");
  return { spec, expiresAt };
}

/** All credential-bearing commands go to the exe.dev control plane, never SSH. */
export class ExeRunProxy {
  constructor(private execute: (command: string) => Promise<BackendCommandResult>) {}

  private async inventory(): Promise<Integration[]> {
    const result = await this.execute("integrations list --json");
    if (!result.ok) throw new Error("Run proxy inventory is unavailable; check the exe.dev integrations list permission");
    let parsed: any;
    try { parsed = JSON.parse(result.body); } catch { throw new Error("Run proxy inventory is invalid"); }
    const items = Array.isArray(parsed) ? parsed : parsed.integrations;
    if (!Array.isArray(items) || items.some(item => !item || typeof item.name !== "string" || typeof item.type !== "string")) throw new Error("Run proxy inventory is invalid");
    return items;
  }

  private owned(integration: Integration, runId: string) {
    return integration.name === runProxyName(runId) && integration.type === "http-proxy" && integration.comment === `Factorize run ${runId}`;
  }

  async prepare(runId: string): Promise<ProxyPlan> {
    const name = runProxyName(runId), existing = (await this.inventory()).find(item => item.name === name);
    if (existing && !this.owned(existing, runId)) throw new Error("Run proxy name is already owned by another integration; refusing to change it");
    return { name, runId, exists: Boolean(existing) };
  }

  async provision(plan: ProxyPlan, vm: string, targetOrigin: string, credential: string): Promise<void> {
    const target = new URL(targetOrigin);
    if (target.protocol !== "https:" || target.origin !== targetOrigin) throw new Error("Run proxy target must be an HTTPS origin");
    // Retry by replacing only our marked integration. Recheck ownership before
    // deletion; the inventory may have changed since prepare. This uses the
    // add/remove permissions exposed by exe.dev's token picker.
    if (plan.exists) await this.remove(plan.name, plan.runId);
    const command = `integrations add http-proxy --name=${shellAtom(plan.name)} --target=${shellAtom(targetOrigin)} --bearer=${shellAtom(credential)} --comment=${shellAtom(`Factorize run ${plan.runId}`)}`;
    // Never include provider responses, exception messages, or command text in
    // errors: an upstream error can echo the bearer credential being installed.
    let installed: BackendCommandResult;
    try { installed = await this.execute(command); }
    catch { throw new Error("Run proxy provisioning was interrupted; reconciliation and cleanup are required"); }
    if (!installed.ok) throw new Error(`Run proxy provisioning failed (HTTP ${installed.status}); check exe.dev integrations add permission`);
    const attached = await this.execute(`integrations attach ${shellAtom(plan.name)} ${shellAtom(`vm:${vm}`)} --for=24h`);
    if (!attached.ok) throw new Error("Run proxy attachment failed; check the exe.dev integrations attach permission");
  }

  private async guestJson(vm: string, url: string): Promise<any> {
    const result = await this.execute(`ssh ${shellAtom(vm)} ${shellAtom(`curl --silent --show-error --max-time 10 --max-filesize 65536 ${shellAtom(url)}`)}`);
    if (!result.ok) throw new Error("Run proxy preflight could not contact an attached integration");
    try { return JSON.parse(result.body); } catch { return null; }
  }

  private async checkIsolation(vm: string, runId: string, targetOrigin: string, tags: string[], requireOwn: boolean): Promise<void> {
    const integrations = (await this.inventory()).filter(item => {
      if (item.type !== "http-proxy" || !item.target) return false;
      try { return new URL(item.target).origin === targetOrigin; } catch { return false; }
    });
    const name = runProxyName(runId), own = integrations.find(item => item.name === name);
    if (own) {
      if (!this.owned(own, runId) || !Array.isArray(own.attachments)) throw new Error("The run proxy ownership and attachments could not be verified");
      for (const value of own.attachments) {
        const grant = attachment(value);
        if ((grant.expiresAt === undefined || grant.expiresAt > Date.now()) && grant.spec !== `vm:${vm}`) throw new Error("The run proxy must be attached only to its execution VM");
      }
    }
    if (requireOwn) {
      if (!own || !this.owned(own, runId) || !Array.isArray(own.attachments) || own.attachments.length !== 1) throw new Error("The run proxy must be attached only to its execution VM");
      const grant = attachment(own.attachments[0]);
      if (grant.spec !== `vm:${vm}` || !grant.expiresAt || grant.expiresAt <= Date.now() || grant.expiresAt > Date.now() + 24 * 60 * 60_000 + 60_000) throw new Error("The run proxy requires a live VM-specific attachment of at most 24 hours");
    }
    // Enforce isolation from control-plane attachments, not guest-reported
    // metadata or a model's choice to include an optional identity header.
    for (const integration of integrations.filter(item => item.name !== name)) {
      if (!Array.isArray(integration.attachments)) throw new Error(`Cannot verify attachments for Factorize integration ${integration.name}`);
      const attached = integration.attachments.some(value => {
        const grant = attachment(value);
        if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) return false;
        return grant.spec === "auto:all" || grant.spec === `vm:${vm}` || tags.some(tag => grant.spec === `tag:${tag}`);
      });
      if (attached) throw new Error(`Unsafe shared Factorize integration ${integration.name} is attached to this execution VM. Restrict it to operator-only VM attachments before retrying`);
    }
  }

  async assertIsolated(vm: string, runId: string, targetOrigin: string, tags: string[] = []): Promise<void> {
    await this.checkIsolation(vm, runId, targetOrigin, tags, false);
  }

  async verify(vm: string, runId: string, targetOrigin: string, tags: string[] = []): Promise<void> {
    await this.checkIsolation(vm, runId, targetOrigin, tags, true);
    const name = runProxyName(runId);
    const reflection = await this.guestJson(vm, "https://reflection.int.exe.xyz/integrations");
    if (!Array.isArray(reflection?.integrations)) throw new Error("Reflection integrations are unavailable during run proxy preflight");
    const proxy: Integration | undefined = reflection.integrations.find((item: Integration) => item.name === name && item.type === "http-proxy");
    if (!proxy) throw new Error("The run-specific Factorize proxy is missing from Reflection");
    const address = proxy.help?.match(/https:\/\/[^\s'"<>]+/)?.[0];
    if (!address) throw new Error("Reflection must publish the run proxy URL");
    const url = new URL(address);
    if (url.protocol !== "https:" || url.hostname !== `${name}.int.exe.xyz`) throw new Error("Reflection returned an unexpected run proxy URL");
    const context = await this.guestJson(vm, `${url.origin}/api/v1/runtime-context`);
    if (context?.kind !== "factorize-runtime-context-v1" || context.authMethod !== "run_token" || context.runId !== runId || !Array.isArray(context.scopes) || !context.scopes.includes("runs:invoke")) throw new Error("The run proxy identity could not be verified");
  }

  async remove(name: string, runId: string): Promise<void> {
    if (name !== runProxyName(runId)) throw new Error("Refusing to remove an unrelated run proxy");
    const existing = (await this.inventory()).find(item => item.name === name);
    if (!existing) return;
    if (!this.owned(existing, runId)) throw new Error("Run proxy ownership marker does not match; refusing deletion");
    const result = await this.execute(`integrations remove ${shellAtom(name)}`);
    if (!result.ok && result.status !== 404) throw new Error("Run proxy cleanup failed; check the exe.dev integrations remove permission");
  }
}
