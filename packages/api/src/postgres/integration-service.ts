import { AmpBackend, type AmpConnection } from "../amp-backend";
import { ExeIntegrationError, ExeVmBackend } from "../exe-vm-backend";
import type { ExeConnection } from "../exe";
import type { AmpConnectionInput, ExeConnectionInput, TailIntegrationInput } from "../types";
import { signTailDelivery, verifyTailDelivery } from "../cloudflare-tail";
import type { Database } from "./database";
import { ConnectionRepository } from "./connection-repository";

const timestamp = () => new Date().toISOString();
const tailSecret = () => `fztail_${Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const tags = (value: unknown) => Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];

export class IntegrationService {
  readonly connections: ConnectionRepository;
  constructor(private database: Database, private tenantId: string, encryptionKey: string) { this.connections = new ConnectionRepository(database, tenantId, encryptionKey); }

  async saveExe(value: ExeConnectionInput) {
    const existing = value.connectionId ? await this.connections.get<ExeConnection>(`exe:${value.connectionId}`) : null;
    const apiToken = value.apiToken || existing?.apiToken;
    if (!apiToken) throw new ExeIntegrationError("An exe.dev HTTPS token is required");
    const tags = Array.isArray(value.tags) ? value.tags.map(String).map(tag => tag.trim()).filter(Boolean) : [];
    if (tags.length > 20 || tags.some(tag => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag))) throw new ExeIntegrationError("VM tags are invalid");
    const candidate: ExeConnection = { apiToken, tags, ...(value.agentKind ? { agentKind: value.agentKind } : {}) };
    const backend = new ExeVmBackend(candidate), permissions = await backend.testPermissions();
    if (!permissions.ok) {
      if (permissions.checks.some(check => check.status === 401)) throw new ExeIntegrationError("exe.dev rejected the account token. Check that it is valid and has not expired.");
      if (permissions.missingPermissions.length) throw new ExeIntegrationError(`exe.dev token is missing required permissions: ${permissions.missingPermissions.map(command => command === "integrations" ? "integrations list" : command).join(", ")}`);
      const failed = permissions.checks.find(check => !check.ok);
      throw new ExeIntegrationError(`exe.dev credential verification failed${failed ? ` for ${failed.requestBody} (HTTP ${failed.status})` : ""}. Try again shortly.`);
    }
    const validation = value.agentKind ? await backend.validateAgentAndModels(value.agentKind) : undefined, connectionId = value.connectionId || crypto.randomUUID();
    const saved = { ...candidate, ...(validation ? { models: validation.models, modelsRefreshedAt: timestamp() } : {}) };
    await this.connections.put(`exe:${connectionId}`, saved);
    await this.database.pool.query("INSERT INTO app.execution_targets(tenant_id,id,name,integration_kind,integration_id,tags,agent_kind) VALUES ($1,gen_random_uuid(),$2,'exe',$3,$4,$5) ON CONFLICT (tenant_id,integration_kind,integration_id,name) DO NOTHING", [this.tenantId, `exe.dev · ${connectionId.slice(0, 8)}`, connectionId, JSON.stringify(tags), value.agentKind]);
    return { ok: true, connectionId, ...(validation ? { models: validation.models } : {}) };
  }
  async testExe(input: Partial<ExeConnectionInput>) {
    const saved = input.connectionId ? await this.connections.get<ExeConnection>(`exe:${input.connectionId}`) : null;
    const connection = input.apiToken ? input as ExeConnection : saved; if (!connection?.apiToken) throw new Error("Account-level exe.dev HTTPS token is required");
    const result = await new ExeVmBackend(connection).testPermissions();
    return { ok: result.ok, missingPermissions: result.missingPermissions, tags: result.tags, checks: result.checks.map(check => ({ command: check.requestBody, ok: check.ok, httpStatus: check.status, exitCode: check.exitCode, output: check.body })) };
  }
  async diagnoseExe(connectionId: string) {
    const connection = await this.connections.get<ExeConnection>(`exe:${connectionId}`); if (!connection) return null;
    const backend = new ExeVmBackend(connection), permissions = await backend.testPermissions();
    if (!permissions.ok) return { ok: false, connectionId, agentKind: connection.agentKind, permissions: { ok: false, missing: permissions.missingPermissions, tags: permissions.tags }, agent: null };
    try { const validation = connection.agentKind ? await backend.validateAgentAndModels(connection.agentKind) : undefined; return { ok: true, connectionId, agentKind: connection.agentKind, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: validation ? { ok: true, models: validation.models } : null }; }
    catch (error) { return { ok: false, connectionId, agentKind: connection.agentKind, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Agent validation failed" } }; }
  }
  async diagnoseExeTarget(targetId: string, connectionId: string, tags: string[], agentKind: "codex" | "claude" | "pi") {
    const connection = await this.connections.get<ExeConnection>(`exe:${connectionId}`); if (!connection) return null;
    const backend = new ExeVmBackend({ apiToken: connection.apiToken, tags });
    const permissions = await backend.testPermissions();
    if (!permissions.ok) return { ok: false, targetId, integrationId: connectionId, agentKind, tags, permissions: { ok: false, missing: permissions.missingPermissions, tags: permissions.tags }, agent: null };
    try { const validation = await backend.validateAgentAndModels(agentKind); return { ok: true, targetId, integrationId: connectionId, agentKind, tags, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: { ok: true, models: validation.models } }; }
    catch (error) { return { ok: false, targetId, integrationId: connectionId, agentKind, tags, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Agent validation failed" } }; }
  }
  async saveAmp(value: AmpConnectionInput) { const existing = value.connectionId ? await this.connections.get<AmpConnection>(`amp:${value.connectionId}`) : null, accessToken = value.accessToken || existing?.accessToken, project = value.project || existing?.project; if (!accessToken || !project) throw new Error("Amp access token and project are required"); const connection = { ...existing, ...value, accessToken, project }; if (!await new AmpBackend(connection).test()) throw new Error("Amp connection verification failed"); const connectionId = value.connectionId || crypto.randomUUID(); await this.connections.put(`amp:${connectionId}`, connection); await this.database.pool.query("INSERT INTO app.execution_targets(tenant_id,id,name,integration_kind,integration_id,tags,agent_kind) VALUES ($1,gen_random_uuid(),$2,'amp',$3,'[]','Amp') ON CONFLICT (tenant_id,integration_kind,integration_id,name) DO NOTHING", [this.tenantId, `Amp · ${project}`, connectionId]); return { ok: true, connectionId }; }
  async testAmp(input: Partial<AmpConnectionInput>) { const saved = input.connectionId ? await this.connections.get<AmpConnection>(`amp:${input.connectionId}`) : null, connection = input.accessToken ? input as AmpConnection : saved; if (!connection?.accessToken || !connection.project) throw new Error("Amp connection is required"); return { ok: await new AmpBackend(connection).test() }; }

  async remove(kind: "exe" | "amp", id: string) {
    const targetKind = kind === "exe" ? "exe-vm" : "Amp";
    const used = await this.database.pool.query("SELECT 1 FROM app.jobs WHERE tenant_id=$1 AND execution_target->>'connectionId'=$2 AND execution_target->>'agentKind' " + (kind === "exe" ? "<> 'Amp'" : "= 'Amp'") + " LIMIT 1", [this.tenantId, id]);
    const targetUsed = await this.database.pool.query("SELECT 1 FROM app.execution_targets WHERE tenant_id=$1 AND integration_kind=$2 AND integration_id=$3 LIMIT 1", [this.tenantId, kind, id]);
    if (used.rowCount || targetUsed.rowCount) return { conflict: true, deleted: false };
    return { conflict: false, deleted: await this.connections.delete(`${kind}:${id}`), targetKind };
  }

  async saveTail(value: TailIntegrationInput) {
    const name = String(value.name ?? "").trim(); if (!name || name.length > 120) throw new Error("A Tail installation name is required");
    const existing = value.integrationId ? await this.connections.get<any>(`cloudflare-tail:${value.integrationId}`) : null, supplied = String(value.signingSecret ?? "");
    if (supplied && supplied.length < 16) throw new Error("Tail signing secrets must be at least 16 characters");
    const signingSecret = supplied || (value.generateSecret ? tailSecret() : existing?.signingSecret); if (!signingSecret) throw new Error("Paste or generate a signing secret");
    const integrationId = value.integrationId || crypto.randomUUID(), now = timestamp();
    await this.connections.put(`cloudflare-tail:${integrationId}`, { name, signingSecret, createdAt: existing?.createdAt ?? now, updatedAt: now });
    return { integrationId, name, status: "connected", secretConfigured: true, ...(value.generateSecret ? { generatedSecret: signingSecret } : {}) };
  }
  async tails(loaded?: Map<string, any> | Promise<Map<string, any>>) {
    const [connections, counts] = await Promise.all([
      loaded ?? this.connections.all(["cloudflare-tail:"]),
      this.database.pool.query<{ integration_id: string; count: string }>("SELECT config->>'integrationId' integration_id,count(DISTINCT job_id)::text count FROM app.triggers WHERE tenant_id=$1 AND removed_at IS NULL AND kind='webhook' AND config->>'provider'='cloudflareTail' GROUP BY config->>'integrationId'", [this.tenantId]),
    ]);
    const byId = new Map(counts.rows.map(row => [row.integration_id, Number(row.count)]));
    return [...connections].filter(([kind]) => kind.startsWith("cloudflare-tail:")).map(([kind, value]) => {
      const integrationId = kind.slice(16);
      return { integrationId, name: text(value?.name) ?? "Unnamed Tail integration", status: "connected" as const, secretConfigured: true as const, ...(text(value?.createdAt) ? { createdAt: text(value.createdAt) } : {}), ...(text(value?.updatedAt) ? { updatedAt: text(value.updatedAt) } : {}), referencedJobCount: byId.get(integrationId) ?? 0 };
    });
  }
  async testTail(id: string) { const value = await this.connections.get<any>(`cloudflare-tail:${id}`); if (!value) return null; const now = String(Date.now()), delivery = `test-${crypto.randomUUID()}`, body = "{}", signature = await signTailDelivery(value.signingSecret, now, delivery, body); return { ok: await verifyTailDelivery(value.signingSecret, now, delivery, body, signature) === "valid" }; }
  async status() {
    const connectionsPromise = this.connections.all(["linear", "clickup", "exe:", "amp:", "cloudflare-tail:"]);
    const [connections, tails] = await Promise.all([connectionsPromise, this.tails(connectionsPromise)]);
    const linear = connections.get("linear"), clickup = connections.get("clickup");
    const exeConnections = [...connections].filter(([kind]) => kind.startsWith("exe:")).map(([kind, value]) => ({ connectionId: kind.slice(4), credentialStatus: "connected" as const, accountTags: tags(value?.accountTags) }));
    const ampConnections = [...connections].filter(([kind]) => kind.startsWith("amp:")).map(([kind, value]) => ({ connectionId: kind.slice(4), project: text(value?.project) ?? "Unnamed Amp project", ...(text(value?.apiBaseUrl) ? { apiBaseUrl: text(value.apiBaseUrl) } : {}) }));
    return { linear: linear ? { organizationName: text(linear.organizationName) ?? null, viewerEmail: text(linear.viewerEmail) ?? null } : null, clickup: clickup ? { teamName: text(clickup.teamName) ?? null } : null, exe: exeConnections[0] ?? null, exeConnections, ampConnections, cloudflareTail: { count: tails.length, installations: tails } };
  }
}
