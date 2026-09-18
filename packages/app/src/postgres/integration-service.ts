import { AmpBackend, type AmpConnection } from "../amp-backend";
import { ExeVmBackend } from "../exe-vm-backend";
import type { ExeConnection } from "../exe";
import type { AmpConnectionInput, ExeConnectionInput, TailIntegrationInput } from "../types";
import { signTailDelivery, verifyTailDelivery } from "../cloudflare-tail";
import type { Database } from "./database";
import { ConnectionRepository } from "./connection-repository";

const timestamp = () => new Date().toISOString();
const tailSecret = () => `fztail_${Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("")}`;

export class IntegrationService {
  readonly connections: ConnectionRepository;
  constructor(private database: Database, private tenantId: string, encryptionKey: string) { this.connections = new ConnectionRepository(database, tenantId, encryptionKey); }

  async saveExe(value: ExeConnectionInput) {
    if (!value.apiToken || !["codex", "claude", "pi"].includes(value.agentKind)) throw new Error("An account-level exe.dev HTTPS token and agent are required");
    const tags = Array.isArray(value.tags) ? value.tags.map(String).map(tag => tag.trim()).filter(Boolean) : [];
    if (tags.length > 20 || tags.some(tag => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(tag))) throw new Error("VM tags are invalid");
    const candidate: ExeConnection = { apiToken: value.apiToken, tags, agentKind: value.agentKind, models: [], modelsRefreshedAt: "" };
    const backend = new ExeVmBackend(candidate), permissions = await backend.testPermissions();
    if (!permissions.ok) throw new Error(`exe.dev token is missing required permissions: ${permissions.missingPermissions.join(", ")}`);
    const validation = await backend.validateAgentAndModels(value.agentKind), connectionId = value.connectionId || crypto.randomUUID();
    const saved = { ...candidate, models: validation.models, modelsRefreshedAt: timestamp() };
    await this.connections.put(`exe:${connectionId}`, saved);
    return { ok: true, connectionId, models: validation.models };
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
    try { const validation = await backend.validateAgentAndModels(connection.agentKind); return { ok: true, connectionId, agentKind: connection.agentKind, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: { ok: true, models: validation.models } }; }
    catch (error) { return { ok: false, connectionId, agentKind: connection.agentKind, permissions: { ok: true, missing: [], tags: permissions.tags }, agent: { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Agent validation failed" } }; }
  }
  async saveAmp(value: AmpConnectionInput) { if (!value.accessToken || !value.project) throw new Error("Amp access token and project are required"); if (!await new AmpBackend(value).test()) throw new Error("Amp connection verification failed"); const connectionId = value.connectionId || crypto.randomUUID(); await this.connections.put(`amp:${connectionId}`, value); return { ok: true, connectionId }; }
  async testAmp(input: Partial<AmpConnectionInput>) { const saved = input.connectionId ? await this.connections.get<AmpConnection>(`amp:${input.connectionId}`) : null, connection = input.accessToken ? input as AmpConnection : saved; if (!connection?.accessToken || !connection.project) throw new Error("Amp connection is required"); return { ok: await new AmpBackend(connection).test() }; }

  async remove(kind: "exe" | "amp", id: string) {
    const targetKind = kind === "exe" ? "exe-vm" : "Amp";
    const used = await this.database.pool.query("SELECT 1 FROM app.jobs WHERE tenant_id=$1 AND execution_target->>'connectionId'=$2 AND execution_target->>'agentKind' " + (kind === "exe" ? "<> 'Amp'" : "= 'Amp'") + " LIMIT 1", [this.tenantId, id]);
    if (used.rowCount) return { conflict: true, deleted: false };
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
  async tails() {
    const values = [] as any[];
    for (const kind of await this.connections.kinds("cloudflare-tail:")) { const value = await this.connections.get<any>(kind); const integrationId = kind.slice(16); const count = await this.database.pool.query<{ count: string }>("SELECT count(DISTINCT job_id)::text count FROM app.triggers WHERE tenant_id=$1 AND kind='webhook' AND config->>'provider'='cloudflareTail' AND config->>'integrationId'=$2", [this.tenantId, integrationId]); const { signingSecret: _, ...safe } = value; values.push({ ...safe, integrationId, status: "connected", secretConfigured: true, referencedJobCount: Number(count.rows[0]?.count ?? 0) }); }
    return values;
  }
  async testTail(id: string) { const value = await this.connections.get<any>(`cloudflare-tail:${id}`); if (!value) return null; const now = String(Date.now()), delivery = `test-${crypto.randomUUID()}`, body = "{}", signature = await signTailDelivery(value.signingSecret, now, delivery, body); return { ok: await verifyTailDelivery(value.signingSecret, now, delivery, body, signature) === "valid" }; }
  async status() {
    const linear = await this.connections.get<any>("linear"), clickup = await this.connections.get<any>("clickup"), exeConnections = [], ampConnections = [];
    for (const kind of await this.connections.kinds("exe:")) { const { apiToken: _, ...safe } = await this.connections.get<any>(kind); exeConnections.push({ ...safe, connectionId: kind.slice(4) }); }
    for (const kind of await this.connections.kinds("amp:")) { const { accessToken: _, ...safe } = await this.connections.get<any>(kind); ampConnections.push({ ...safe, connectionId: kind.slice(4) }); }
    const tails = await this.tails(); return { linear: linear ? { organizationName: linear.organizationName ?? null, viewerEmail: linear.viewerEmail ?? null } : null, clickup: clickup ? { teamName: clickup.teamName ?? null } : null, exe: exeConnections[0] ?? null, exeConnections, ampConnections, cloudflareTail: { count: tails.length, installations: tails } };
  }
}
