export async function scheduleValidation(steps, { run, concurrency, signal }) {
  const pending = new Map(steps.map(step => [step.id, step]));
  const active = new Map();
  const results = new Map();

  while (pending.size || active.size) {
    const remaining = pending.size;
    for (const [id, step] of pending) {
      const dependencies = step.after ?? [];
      if (signal.aborted || dependencies.some(dependency =>
        results.has(dependency) && results.get(dependency).status !== "passed")) {
        results.set(id, { id, status: "not run" });
        pending.delete(id);
      } else if (active.size < concurrency && dependencies.every(dependency => results.has(dependency))) {
        const start = performance.now();
        active.set(id, run(step).then(code => ({
          id,
          status: code === 0 ? "passed" : "failed",
          seconds: (performance.now() - start) / 1000,
        })));
        pending.delete(id);
      }
    }
    if (active.size) {
      const result = await Promise.race(active.values());
      active.delete(result.id);
      results.set(result.id, result);
    } else if (pending.size && pending.size === remaining) {
      throw new Error("Validation steps have unresolved dependencies: " + [...pending.keys()].join(", "));
    }
  }

  return steps.map(({ id }) => results.get(id));
}
