import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/postgres/database";
import { RunEnrollmentRepository, type RunEnrollmentBinding } from "../src/postgres/run-enrollment-repository";
import { RunEnrollmentService } from "../src/run-enrollment-service";

const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("single-use run enrollments (PostgreSQL)", () => {
  let db: Database;
  const tenants: string[] = [];
  beforeAll(async () => {
    db = new Database({ connectionString: url, max: 24, maxUses: Infinity });
    expect((await db.pool.query("SELECT to_regclass('app.credential_run_enrollments') AS enrollments")).rows[0]?.enrollments).toBe("app.credential_run_enrollments");
  }, 30_000);
  afterAll(async () => { if (db) { await db.pool.query("DELETE FROM app.tenants WHERE id=ANY($1::uuid[])", [tenants]); await db.close(); } });

  async function fixture(state = "running") {
    const tenantId = crypto.randomUUID(), jobId = crypto.randomUUID(), triggerId = crypto.randomUUID(), invocationId = crypto.randomUUID(), runId = crypto.randomUUID();
    const proxyIdentity = `proxy-${crypto.randomUUID()}`, bootEpoch = crypto.randomUUID(), vmIdentity = `vm-${crypto.randomUUID()}`;
    tenants.push(tenantId);
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [tenantId]);
    await db.pool.query("INSERT INTO app.projects(tenant_id,id,name) VALUES ($1,md5(($1::uuid)::text || ':default')::uuid,'Default')", [tenantId]);
    await db.pool.query("INSERT INTO app.jobs(tenant_id,id,project_id,name,slug,encrypted_prompt_template,execution_config,concurrency_limit) VALUES ($1,$2,md5(($1::uuid)::text || ':default')::uuid,'Enrollment test','enrollment-test','test','{}',1)", [tenantId, jobId]);
    await db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','manual')", [tenantId, triggerId, jobId]);
    await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,trigger_id,context) VALUES ($1,$2,$3,'manual','enrollment-test',$4,'{}')", [tenantId, invocationId, jobId, triggerId]);
    await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt) VALUES ($1,$2,$3,$4,$5,'test')", [tenantId, runId, jobId, invocationId, state]);
    const binding: RunEnrollmentBinding = { tenantId, runId, vmIdentity, proxyIdentity, bootEpoch };
    const repository = new RunEnrollmentRepository(db);
    const service = new RunEnrollmentService(repository);
    await repository.setProxyState({ tenantId, proxyIdentity, bootEpoch });
    expect(await repository.authorizeRun(binding)).toBe(1);
    return { binding, repository, service, tenantId, runId, proxyIdentity, bootEpoch };
  }
  async function enrollment(f: Awaited<ReturnType<typeof fixture>>, lifetime = 60_000) {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const issued = await f.service.enroll(f.binding, new Date(now.getTime() + lifetime), now);
    return { ...issued, now };
  }

  it("atomically consumes one token once across barrier-synchronized concurrent callers", async () => {
    const f = await fixture(), issued = await enrollment(f), count = 24;
    let arrivals = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const results = await Promise.allSettled(Array.from({ length: count }, async () => {
      arrivals += 1;
      if (arrivals === count) release();
      await barrier;
      return f.service.authenticate(issued.token, f.binding, issued.now);
    }));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(count - 1);
    const persisted = (await db.pool.query("SELECT token_digest,consumed_at,grant_revision FROM app.credential_run_enrollments WHERE tenant_id=$1 AND id=$2", [f.tenantId, issued.enrollmentId])).rows[0];
    expect(persisted.token_digest.toString("base64url")).not.toBe(issued.token);
    expect(persisted.consumed_at).toEqual(issued.now);
    expect(persisted.grant_revision).toBe("1");
  }, 20_000);

  it("rejects expiry, disconnect replay, a changed proxy epoch, ended runs, cross-tenant use, and revoked or disabled grants", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const expired = await fixture(), old = await enrollment(expired, 1);
    await expect(expired.service.authenticate(old.token, expired.binding, new Date(now.getTime() + 1))).rejects.toThrow();

    const disconnected = await fixture(), lost = await enrollment(disconnected);
    const reconnected = await enrollment(disconnected);
    await expect(disconnected.service.authenticate(lost.token, disconnected.binding, lost.now)).rejects.toThrow();
    await expect(disconnected.service.authenticate(reconnected.token, disconnected.binding, reconnected.now)).resolves.toMatchObject({ grantRevision: 1 });
    await expect(disconnected.service.authenticate(reconnected.token, disconnected.binding, reconnected.now)).rejects.toThrow();

    const revised = await fixture(), priorRevision = await enrollment(revised);
    expect(await revised.repository.authorizeRun({ ...revised.binding, vmIdentity: `${revised.binding.vmIdentity}-replacement` })).toBe(2);
    await expect(revised.service.authenticate(priorRevision.token, revised.binding, priorRevision.now)).rejects.toThrow();

    const restarted = await fixture(), oldEpoch = await enrollment(restarted);
    const newEpoch = crypto.randomUUID();
    await restarted.repository.setProxyState({ tenantId: restarted.tenantId, proxyIdentity: restarted.proxyIdentity, bootEpoch: newEpoch });
    await expect(restarted.service.authenticate(oldEpoch.token, restarted.binding, oldEpoch.now)).rejects.toThrow();
    const restartedBinding = { ...restarted.binding, bootEpoch: newEpoch };
    expect(await restarted.repository.authorizeRun(restartedBinding)).toBe(2);
    expect(await restarted.repository.authorizeRun(restartedBinding)).toBe(2);
    const fresh = await restarted.service.enroll(restartedBinding, new Date(now.getTime() + 60_000), now);
    await expect(restarted.service.authenticate(fresh.token, restartedBinding, now)).resolves.toMatchObject({ bootEpoch: newEpoch, grantRevision: 2 });

    const ended = await fixture(), endedEnrollment = await enrollment(ended);
    await db.pool.query("UPDATE app.job_runs SET state='succeeded' WHERE tenant_id=$1 AND id=$2", [ended.tenantId, ended.runId]);
    await expect(ended.service.authenticate(endedEnrollment.token, ended.binding, endedEnrollment.now)).rejects.toThrow();

    const tenantScoped = await fixture(), scoped = await enrollment(tenantScoped);
    await expect(tenantScoped.service.authenticate(scoped.token, { ...tenantScoped.binding, tenantId: crypto.randomUUID() }, scoped.now)).rejects.toThrow();

    const revoked = await fixture(), revokedEnrollment = await enrollment(revoked);
    await revoked.repository.revokeRun(revoked.tenantId, revoked.runId);
    await expect(revoked.service.authenticate(revokedEnrollment.token, revoked.binding, revokedEnrollment.now)).rejects.toThrow();
    expect(await revoked.repository.authorizeRun(revoked.binding)).toBe(2);

    const disabled = await fixture(), disabledEnrollment = await enrollment(disabled);
    await disabled.repository.setProxyState({ tenantId: disabled.tenantId, proxyIdentity: disabled.proxyIdentity, bootEpoch: disabled.bootEpoch, disabled: true });
    await expect(disabled.service.authenticate(disabledEnrollment.token, disabled.binding, disabledEnrollment.now)).rejects.toThrow();
  }, 30_000);
});
