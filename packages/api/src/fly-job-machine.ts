import type { FlyMachineConfig } from "./fly-machines-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$/;

export type FlyJobMachineInput = {
  runId: string;
  operationId: string;
  image: string;
  region: string;
  size: string;
};

/**
 * Build the public, non-secret part of a run Machine. Work is started only
 * after creation so the caller can deliver its payload through guest exec;
 * provider restarts are disabled to avoid replaying a job after a crash.
 */
export function flyJobMachineConfig(app: string, input: FlyJobMachineInput): FlyMachineConfig {
  if (!APP.test(app)) throw new TypeError("Invalid Fly app name");
  if (!UUID.test(input.runId) || !input.operationId || input.operationId.length > 200) throw new TypeError("Invalid Fly run identity");
  if (!IMAGE.test(input.image)) throw new TypeError("Invalid Fly execution image");
  if (!/^[a-z0-9]{3}$/.test(input.region)) throw new TypeError("Invalid Fly execution region");
  const size = input.size.match(/^(shared-cpu|performance)-(1|2|4)x$/);
  if (!size) throw new TypeError("Invalid Fly execution size");
  const cpuCount = Number(size[2]);

  return {
    image: input.image,
    region: input.region,
    guest: { cpu_kind: size[1] === "shared-cpu" ? "shared" : "performance", cpus: cpuCount, memory_mb: cpuCount * 1024 },
    metadata: {
      factorize_role: "job",
      factorize_run_id: input.runId.toLowerCase(),
      factorize_operation_id: input.operationId,
    },
    auto_start: false,
    auto_stop: false,
    restart: { policy: "no" },
  };
}
