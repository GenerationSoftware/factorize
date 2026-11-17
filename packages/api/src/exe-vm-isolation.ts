import type { BackendCommandResult } from "./execution";

type Integration = {name?: string; type?: string; target?: string; attachments?: unknown[]};
/** Reject any native Factorize bearer proxy available at boot. Only the
 * vendor-authenticated local helper may grant a run Factorize API access. */
export async function assertExeVmIsolation(input: {execute: (command: string) => Promise<BackendCommandResult>; vm: string; backendOrigin: string; tags: string[]}): Promise<void> {
  const response = await input.execute("integrations list --json");
  if (!response.ok) throw new Error("exe.dev integration isolation inventory unavailable");
  let inventory: unknown;
  try { inventory = JSON.parse(response.body); } catch { throw new Error("exe.dev integration isolation inventory invalid"); }
  const integrations: Integration[] = Array.isArray(inventory) ? inventory : (inventory as {integrations: Integration[]})?.integrations;
  if (!Array.isArray(integrations)) throw new Error("exe.dev integration isolation inventory invalid");
  for (const integration of integrations) {
    if (integration.type !== "http-proxy") continue;
    let target: URL;
    try { target = new URL(integration.target ?? ""); } catch { throw new Error("exe.dev integration target unavailable for isolation check"); }
    if (target.origin !== input.backendOrigin) continue;
    if (!Array.isArray(integration.attachments)) throw new Error("exe.dev Factorize attachment inventory unavailable");
    for (const entry of integration.attachments) {
      if (typeof entry !== "string") throw new Error("exe.dev Factorize attachment inventory invalid");
      const match = /^(.*?)(?:@(.+))?$/.exec(entry)!;
      const spec = match[1]!;
      if (match[2]) { const expiry = Date.parse(match[2]); if (!Number.isFinite(expiry)) throw new Error("exe.dev attachment expiry invalid"); if (expiry <= Date.now()) continue; }
      if (spec === "auto:all" || spec === `vm:${input.vm}` || input.tags.some(tag => spec === `tag:${tag}`)) throw new Error("A shared Factorize integration is attached to this execution VM. Restrict its attachments before retrying.");
    }
  }
}
