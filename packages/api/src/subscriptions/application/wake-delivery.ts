import type { Env } from "../../types";

export async function wakeMcpDeliveries(env: Pick<Env, "SCHEDULER">) {
  if (!env.SCHEDULER) return;
  const alarm = env.SCHEDULER.get(env.SCHEDULER.idFromName("global"));
  const response = await alarm.fetch("https://scheduler/mcp-events", { method: "POST" });
  if (!response.ok) throw new Error("MCP event alarm wake failed");
  await response.body?.cancel();
}
