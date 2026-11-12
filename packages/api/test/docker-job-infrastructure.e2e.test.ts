import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { createDockerJobInfrastructure } from "../src/docker-job-infrastructure";

it("recovers real containers by operation identity, isolates ownership and removes stopped containers", async () => {
  const namespace = `factorize-test-${randomUUID()}`;
  execFileSync("docker", ["network", "create", "--internal", namespace], { timeout: 15_000 });
  const infra = createDockerJobInfrastructure({ testMode: true, namespace, network: namespace });
  const other = createDockerJobInfrastructure({ testMode: true, namespace: `other-${randomUUID()}`, network: namespace });
  const operation = randomUUID();
  let id: string | undefined;
  try {
    const machine = await infra.machines.createMachine(namespace, { image: "alpine:3.22" }, operation);
    id = machine.id;
    expect((await infra.machines.createMachine(namespace, { image: "alpine:3.22" }, operation)).id).toBe(id);
    await expect(other.machines.inspectMachine(namespace, id)).rejects.toThrow("another namespace");
    await infra.machines.startMachine(namespace, id);
    const result = await infra.guest(id).run(["sh", "-c", "read marker; printf '%s' \"$marker\""], "container-executed\n");
    expect(result).toMatchObject({ ok: true, stdout: "container-executed" });
    await infra.machines.stopMachine(namespace, id);
    expect((await infra.machines.inspectMachine(namespace, id)).state).toBe("stopped");
    await infra.machines.destroyMachine(namespace, id);
    expect(await infra.machines.findMachineByOperationId!(namespace, operation)).toBeUndefined();
    id = undefined;
  } finally {
    if (id) execFileSync("docker", ["rm", "-f", id], { timeout: 15_000 });
    execFileSync("docker", ["network", "rm", namespace], { timeout: 15_000 });
  }
}, 60_000);
