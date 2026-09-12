import { CUSTOM_HANDLER_COMPATIBILITY_DATE } from "./custom-handler";

type DeployerEnv = { CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_API_TOKEN: string; CUSTOM_DISPATCH_NAMESPACE: string };
const scriptPattern = /^fh-[a-f0-9]{40}$/;

export default {
  async fetch(request: Request, env: DeployerEnv): Promise<Response> {
    const url = new URL(request.url);
    let scriptName: string;
    let init: RequestInit;
    if (request.method === "PUT" && url.pathname === "/scripts") {
      const input = await request.json() as { scriptName?: unknown; module?: unknown };
      if (typeof input.scriptName !== "string" || !scriptPattern.test(input.scriptName) || typeof input.module !== "string") return new Response("Invalid deployment", { status: 400 });
      scriptName = input.scriptName;
      const metadata = { main_module: "worker.mjs", compatibility_date: CUSTOM_HANDLER_COMPATIBILITY_DATE, bindings: [] };
      const form = new FormData();
      form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.set("worker.mjs", new Blob([input.module], { type: "application/javascript+module" }), "worker.mjs");
      init = { method: "PUT", body: form };
    } else if (request.method === "DELETE") {
      scriptName = decodeURIComponent(url.pathname.slice("/scripts/".length));
      if (!url.pathname.startsWith("/scripts/") || !scriptPattern.test(scriptName)) return new Response("Invalid deployment", { status: 400 });
      init = { method: "DELETE" };
    } else return new Response("Not found", { status: 404 });
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/dispatch/namespaces/${encodeURIComponent(env.CUSTOM_DISPATCH_NAMESPACE)}/scripts/${scriptName}`, { ...init, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    return new Response(null, { status: response.status });
  },
};
