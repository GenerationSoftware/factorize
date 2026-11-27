import { HetznerConnectionRepository } from "../storage/hetzner-connection-repository";
import { AgentApiError } from "../../proxy/api/agent-api-error";
import { appConfig, signingConfig } from "../../config/runtime";
import { cloudflareCredential } from "../../integrations/providers/cloudflare-oauth";
import type { Env } from "../../types";
import { databaseFor } from "../../postgres/database";
import { CredentialRepository } from "../storage/credential-repository";
import { resolveProviderCredentials } from "./provider-credentials";
import type { OutboundCredential } from "../../proxy/transport/outbound-forwarder";
import { CLICKUP_API_BASE } from "../../integrations/providers/clickup";
import { ConnectionRepository } from "../storage/connection-repository";
import { FlyConnectionRepository } from "../storage/fly-connection-repository";
import { isPublicHttpsOrigin } from "../../proxy/transport/public-address";

/** Only call after shared identity/grant authorization. No caller origin or secret. */
export async function resolveAgentCredential(env: Env, tenantId: string, kind: string, credentialId: string, relativePath: string): Promise<OutboundCredential | null> {
  if (kind === "cloudflare") return cloudflareCredential(env, tenantId, credentialId, relativePath);
  const database = databaseFor(env);
  if (kind === "hetzner") {
    if (credentialId !== "hetzner") return null;
    const origin = "https://api.hetzner.cloud";
    const rawPath = relativePath.split("?", 1)[0]!;
    if (!rawPath.startsWith("/") || rawPath.startsWith("//") || /%2f|%5c|%25/i.test(rawPath) || /[\\\s\0#]/.test(relativePath)) {
      throw new AgentApiError(400, "invalid_request", "Use a relative Hetzner Cloud /v1/ API path.");
    }
    const target = new URL(relativePath, origin);
    if (target.origin !== origin || !target.pathname.startsWith("/v1/")) {
      throw new AgentApiError(400, "invalid_request", "Use a relative Hetzner Cloud /v1/ API path.");
    }
    const project = await new HetznerConnectionRepository(database, tenantId, signingConfig(env).credentialKey).get();
    if (!project) return null;
    return { origin, path: target.pathname + target.search, credential: project.token,
      requestHeaders: ["accept", "content-type", "if-match", "if-none-match"] };
  }
  if (kind === "fly") {
    if (credentialId !== "fly") return null;
    const token = await new FlyConnectionRepository(database, tenantId, signingConfig(env).credentialKey).token();
    return token ? {origin: "https://api.machines.dev", path: relativePath, credential: token} : null;
  }
  if (kind === "exe" || kind === "amp" || kind === "clickup") {
    if (kind === "clickup" && credentialId !== "clickup") return null;
    const connection = await new ConnectionRepository(database, tenantId, signingConfig(env).credentialKey)
      .get<{apiToken?: string; accessToken?: string; apiBaseUrl?: string}>(kind === "clickup" ? kind : `${kind}:${credentialId}`);
    const credential = kind === "exe" ? connection?.apiToken : connection?.accessToken;
    if (!credential) return null;
    if (kind === "exe") return {origin: "https://exe.dev", path: relativePath, credential};
    if (kind === "clickup") {
      const base = new URL(CLICKUP_API_BASE), target = new URL(`${CLICKUP_API_BASE}${relativePath}`);
      if (!target.pathname.startsWith(`${base.pathname}/`)) return null;
      return {origin: target.origin, path: `${target.pathname}${target.search}`, credential, authorization: "raw"};
    }
    const base = new URL(connection?.apiBaseUrl || "https://ampcode.com/api/cloud/v1");
    if (!isPublicHttpsOrigin(base.origin, appConfig(env).origin) || base.username || base.password || base.search || base.hash) return null;
    const prefix = base.pathname.replace(/\/$/, "");
    const target = new URL(`${base.origin}${prefix}${relativePath}`);
    // Relative dot segments must not escape the configured API prefix.
    if (!target.pathname.startsWith(`${prefix}/`)) return null;
    return {origin: base.origin, path: `${target.pathname}${target.search}`, credential};
  }
  if (!["bearer", "github", "linear"].includes(kind)) return null;
  const prefix = kind === "bearer" ? `/integrations/${credentialId}` : kind === "github" ? `/providers/github/${credentialId}` : "/providers/linear";
  const separator = relativePath.indexOf("?");
  const path = prefix + (separator < 0 ? relativePath : relativePath.slice(0, separator));
  const url = {search: separator < 0 ? "" : relativePath.slice(separator)};
  const bearer = /^\/integrations\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
  const github = /^\/providers\/github\/([1-9][0-9]*)(\/.*)?$/.exec(path);
  const linear = /^\/providers\/linear(\/.*)?$/.exec(path);
  let selected: OutboundCredential | null = null;
    if (bearer) {
      const credential = await new CredentialRepository(database, tenantId, signingConfig(env).credentialKey).managedCredential(bearer[1]!, "bearer");
      if (!credential?.origin || !isPublicHttpsOrigin(credential.origin, appConfig(env).origin)) return null;
      selected = {origin: credential.origin, path: `${bearer[2] ?? "/"}${url.search}`, credential: credential.payload};
    } else if (github) {
      const installationId = Number(github[1]);
      if (!Number.isSafeInteger(installationId)) return null;
      const resolved = await resolveProviderCredentials({database, env, tenantId: tenantId, githubInstallationIds: [installationId], linearSelected: false});
      const credential = resolved.githubInstallations[0];
      if (!credential?.available || !credential.accessToken) return null;
      let suffix = github[2] ?? "/", origin = "https://api.github.com";
      const smart = /\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(suffix);
      if (smart) origin = "https://github.com";
      else if (suffix.startsWith("/raw/")) { origin = "https://raw.githubusercontent.com"; suffix = suffix.slice(4); }
      else if (suffix.startsWith("/archive/")) { origin = "https://codeload.github.com"; suffix = suffix.slice(8); }
      selected = {origin, path: `${suffix}${url.search}`, credential: credential.accessToken, authorization: smart ? "github-git-basic" : "bearer"};
    } else if (linear) {
      const resolved = await resolveProviderCredentials({database, env, tenantId: tenantId, githubInstallationIds: [], linearSelected: true});
      if (!resolved.linearConnection?.available || !resolved.linearConnection.accessToken) return null;
      selected = {origin: "https://api.linear.app", path: `${linear[1] ?? "/graphql"}${url.search}`, credential: resolved.linearConnection.accessToken};
    }

  return selected;
}
