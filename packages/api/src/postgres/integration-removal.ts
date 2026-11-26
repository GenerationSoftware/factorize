import { z } from "zod";
import { hmac } from "../crypto";
import { AgentApiError } from "../agent-api-error";
import { integrationRemovalPreview, type IntegrationRemovalTarget } from "../integration-removal-contracts";
import { CredentialRepository } from "./credential-repository";
import type { Database, DatabaseClient } from "./database";
import { inspectIntegrationTopology, applyIntegrationTopology, lockIntegrationTopology, lockIntegrationTopologyRows } from "./integration-removal-topology";
import { inspectIntegrationAccess, removeIntegrationAccess } from "./integration-removal-access";

const notFound = () => new AgentApiError(404, "not_found", "Integration not found.");
const stale = () => new AgentApiError(409, "conflict", "Integration impact changed. Review a new preview before removing it.");
type Credential = { stamp: string; name?: string; origin?: string; description?: string | null; singleton?: boolean };
type Registration = { id: string; revision: number; epoch: number };
type Confirmation = { fingerprint: string; confirmImpact: boolean };

export class IntegrationRemoval {
  constructor(private database: Database, private owner: {tenantId:string;userId:string;sessionVersion:number},
    private signingSecret: string, private encryptionKey: string) {}

  private async inspect(sql: DatabaseClient, target: IntegrationRemovalTarget, lockCredential = false) {
    const tenant = this.owner.tenantId;
    const {kind,id} = target;
    const rowLock = lockCredential ? " FOR UPDATE" : "";
    let credential: Credential | undefined;
    let collectionRevision = 0;
    const first = async (query: string, values: unknown[]): Promise<Credential | undefined> => (await sql.query<Credential>(query + rowLock,values)).rows[0];
    if (kind === "exe" || kind === "amp" || kind === "cloudflareTail") {
      const key = (kind === "cloudflareTail" ? "cloudflare-tail" : kind) + ":" + id;
      credential = await first("SELECT xmin::text AS stamp FROM app.connections WHERE tenant_id=$1 AND kind=$2", [tenant,key]);
    } else if (kind === "github") {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw notFound();
      credential = await first("SELECT xmin::text AS stamp FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [tenant,id]);
    } else if (kind === "fly") {
      if (id !== "fly") throw notFound();
      credential = await first("SELECT xmin::text AS stamp FROM app.fly_connections WHERE tenant_id=$1", [tenant]);
    } else if (kind === "cloudflare") {
      if (!z.uuid().safeParse(id).success) throw notFound();
      // Serialize with the Cloudflare authorize/refresh lifecycle before locking the credential.
      if (lockCredential) await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["cloudflare:"+tenant]);
      credential = await first(`SELECT xmin::text AS stamp,account_id IS NULL AS singleton FROM app.cloudflare_connections
        WHERE tenant_id=$1 AND id=$2 AND encrypted_credentials IS NOT NULL`, [tenant,id]);
    } else {
      if (!z.uuid().safeParse(id).success) throw notFound();
      // Bearer writers always lock the collection ahead of individual records.
      collectionRevision = Number((await sql.query("SELECT revision FROM app.integration_collections WHERE tenant_id=$1" + rowLock, [tenant])).rows[0]?.revision ?? 0);
      credential = await first(`SELECT xmin::text AS stamp,name,origin,description FROM app.integration_records
        WHERE tenant_id=$1 AND id=$2 AND kind='bearer' AND deleted_at IS NULL`, [tenant,id]);
    }
    if (!credential) throw notFound();
    const registration = (await sql.query<Registration>("SELECT id,revision,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind=$2 AND credential_id=$3" + rowLock, [tenant,kind,id])).rows[0];
    const topology = await inspectIntegrationTopology(sql,tenant,{...target,registrationId:registration?.id ?? null});
    const access = registration ? await inspectIntegrationAccess(sql,tenant,registration.id) : null;
    const {versions,...visibleTopology} = topology;
    const {evidence,...visibleAccess} = access ?? {clients:[],workloads:[],evidence:null};
    const summary = { ...visibleTopology, ...visibleAccess, needsConfirmation: Boolean(topology.sources.length || topology.lookups.length || visibleAccess.clients.length || visibleAccess.workloads.length) };
    const fingerprint = await hmac(JSON.stringify([tenant,this.owner.userId,this.owner.sessionVersion,target,credential.stamp,registration,collectionRevision,versions,evidence,summary]),this.signingSecret);
    return { preview: integrationRemovalPreview.parse({...summary,fingerprint}), credential, registration, topology, access, collectionRevision };
  }

  async preview(target: IntegrationRemovalTarget) {
    return this.database.transaction(async sql => {
      await lockIntegrationTopology(sql,this.owner.tenantId);
      return (await this.inspect(sql,target)).preview;
    });
  }

  async confirm(target: IntegrationRemovalTarget, confirmation?: Confirmation, legacyBearer?: {expectedRevision:number;idempotencyKey:string}) {
    const tenant = this.owner.tenantId;
    return this.database.transaction(async sql => {
      await lockIntegrationTopology(sql,tenant);
      const before = await this.inspect(sql,target);
      // Event evaluation locks its Trigger before its Event and can refresh provider
      // credentials. Preserve that order before taking credential locks here.
      await lockIntegrationTopologyRows(sql,tenant,before.topology);
      const impact = await this.inspect(sql,target,true);
      if (before.preview.fingerprint !== impact.preview.fingerprint) throw stale();
      if ((confirmation && confirmation.fingerprint !== impact.preview.fingerprint) || (impact.preview.needsConfirmation && !confirmation?.confirmImpact)) throw stale();
      await applyIntegrationTopology(sql,tenant,impact.topology);
      const registry = impact.registration;
      if (registry && impact.access) await removeIntegrationAccess(sql,tenant,registry.id,impact.access);
      const {kind,id} = target;
      let journal: {revision:number;duplicate:boolean} | undefined;
      if (kind === "bearer") {
        const {name,origin,description} = impact.credential;
        if (!name || !origin) throw notFound();
        journal = await new CredentialRepository(this.database,tenant,this.encryptionKey).write({
          id, kind, name, origin, description:description ?? null, operation:"delete",
          expectedRevision:legacyBearer?.expectedRevision ?? impact.collectionRevision,
          idempotencyKey:legacyBearer?.idempotencyKey ?? crypto.randomUUID(),
        },sql);
      } else if (kind === "github") {
        await sql.query("DELETE FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2", [tenant,id]);
      } else if (kind === "fly") {
        await sql.query("DELETE FROM app.fly_connections WHERE tenant_id=$1", [tenant]);
      } else if (kind === "cloudflare") {
        await sql.query("UPDATE app.cloudflare_connections SET encrypted_credentials=NULL WHERE tenant_id=$1 AND id=$2", [tenant,id]);
        // Only the current singleton is replaceable by an in-flight OAuth dialog.
        if (impact.credential.singleton) await sql.query("DELETE FROM app.cloudflare_oauth_attempts WHERE tenant_id=$1", [tenant]);
      } else {
        await sql.query("DELETE FROM app.connections WHERE tenant_id=$1 AND kind=$2", [tenant,(kind === "cloudflareTail" ? "cloudflare-tail" : kind) + ":" + id]);
      }
      if (registry) {
        await sql.query("DELETE FROM app.team_permission_defaults WHERE tenant_id=$1 AND permission=$2", [tenant,"integration:"+registry.id]);
        // Provider/database synchronization can leave an inactive registry row. Keep only concrete
        // FK anchors for retained receipts/operation history or already-revoked VM grants.
        const pruned = await sql.query(`DELETE FROM app.agent_integrations i WHERE tenant_id=$1 AND id=$2
          AND NOT EXISTS (SELECT 1 FROM app.agent_proxy_responses r WHERE (r.tenant_id,r.integration_id)=(i.tenant_id,i.id))
          AND NOT EXISTS (SELECT 1 FROM app.proxy_operations o WHERE (o.tenant_id,o.integration_id)=(i.tenant_id,i.id))
          AND NOT EXISTS (SELECT 1 FROM app.vm_permission_grants v WHERE (v.tenant_id,v.provider_id)=(i.tenant_id,i.id))`, [tenant,registry.id]);
        if (!pruned.rowCount) await sql.query(`UPDATE app.agent_integrations SET available=false,policy='requestable',epoch=greatest(epoch,$3+1),revision=revision+1
          WHERE tenant_id=$1 AND id=$2`, [tenant,registry.id,registry.epoch]);
      }
      return {deleted:true as const,journal};
    });
  }
}
