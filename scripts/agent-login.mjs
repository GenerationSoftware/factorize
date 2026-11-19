// Start a process with the same device authorization for HTTP and MCP.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const origin = new URL(process.env.FACTORIZE_ORIGIN || "https://app.factorize.sh").origin;
if (!origin.startsWith("https://")) throw new Error("Factorize requires HTTPS");
const grant = "urn:ietf:params:oauth:grant-type:device_code";
const post = async (path, body, type) => {
  const response = await fetch(origin + path, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": type },
    body,
  });
  return response.json();
};
const [command = "codex", ...args] = process.argv.slice(2);
const client = await post(
  "/oauth/register",
  JSON.stringify({
    client_name: "Factorize external agent",
    grant_types: [grant],
    token_endpoint_auth_method: "none",
  }),
  "application/json",
);
if (!client.client_id) throw new Error("Device client registration failed");
const form = (path, fields) => post(path, new URLSearchParams(fields), "application/x-www-form-urlencoded");
const device = await form("/oauth/device_authorization", {
  client_id: client.client_id,
  scope: ["proxy:use", "vm:grant", process.env.FACTORIZE_SCOPES || ""].join(" ").trim(),
});
if (!device.device_code) throw new Error("Device authorization failed");
console.error("Open", device.verification_uri, "and approve code", device.user_code);
const deadline = Date.now() + device.expires_in * 1000;
let interval = device.interval || 5;
let token;
while (Date.now() < deadline) {
  await wait(interval * 1000);
  const result = await form("/oauth/token", {
    client_id: client.client_id,
    device_code: device.device_code,
    grant_type: grant,
  });
  if (result.access_token) {
    token = result.access_token;
    break;
  }
  if (result.error === "slow_down") interval += 5;
  else if (result.error !== "authorization_pending")
    throw new Error("Device authorization failed: " + result.error);
}
if (!token) throw new Error("Device authorization expired");
const directory = await mkdtemp(join(tmpdir(), "factorize-agent-"));
const authFile = join(directory, "authorization");
try {
  await writeFile(authFile, "Authorization: Bearer " + token + "\n", { mode: 0o600 });
  const config =
    command === "codex"
      ? [
          "-c",
          "mcp_servers.factorize.url=" + JSON.stringify(origin + "/mcp"),
          "-c",
          'mcp_servers.factorize.bearer_token_env_var="FACTORIZE_AGENT_TOKEN"',
          "-c",
          "shell_environment_policy.set.FACTORIZE_AGENT_AUTH_FILE=" + JSON.stringify(authFile),
        ]
      : [];
  const child = spawn(command, [...config, ...args], {
    stdio: "inherit",
    env: { ...process.env, FACTORIZE_AGENT_TOKEN: token, FACTORIZE_AGENT_AUTH_FILE: authFile },
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
