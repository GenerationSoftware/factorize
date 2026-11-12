import { RunScheduler, type RunBackendFactory } from "./postgres/run-scheduler";
import type { Database } from "./postgres/database";
import type { Env } from "./types";

/** Host process boundary: the API and this runner share DB/storage, never a Docker socket. */
export function createLocalExecutionRunner(database: Database, env: Env, factory: RunBackendFactory) {
  const scheduler = new RunScheduler(database, env, factory);
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const tick = () => {
    if (closed) return Promise.reject(new Error("Execution runner is closed"));
    if (!active) active = scheduler.process().finally(() => { active = undefined; });
    return active;
  };
  return {
    tick,
    start(onError: (error: unknown) => void) {
      if (timer || closed) throw new Error("Execution runner cannot start");
      const loop = async () => {
        try { await tick(); } catch (error) { onError(error); }
        if (!closed) timer = setTimeout(loop, 250);
      };
      timer = setTimeout(loop, 0);
    },
    async close() { closed = true; clearTimeout(timer); await active; },
  };
}
