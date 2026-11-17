import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { CredentialRepository } from "./postgres/credential-repository";
import { resolveRunProviderCredentials } from "./provider-credentials";
import type { OutboundCredential } from "./run-outbound-forwarder";
import { resolveManagedModelCredential } from "./managed-model-credentials";
import { isPublicHttpsOrigin } from "./public-address";

/** Only call after shared identity/grant authorization. No caller origin or secret. */
export async function resolveAgentCredential(env: Env, tenantId: string, kind: string, credentialId: string, relativePath: string): Promise<OutboundCredential | null> {
  const database = databaseFor(env);
  const modelAccountId = credentialId;
  const prefix = kind === "bearer" ? `/integrations/${credentialId}` : kind === "github" ? `/providers/github/${credentialId}` : kind === "linear" ? "/providers/linear" : "/providers/model/v1";
  const separator = relativePath.indexOf("?");
  const path = prefix + (separator < 0 ? relativePath : relativePath.slice(0, separator));
  const url = {search: separator < 0 ? "" : relativePath.slice(separator)};
  const bearer = /^\/integrations\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
  const github = /^\/providers\/github\/([1-9][0-9]*)(\/.*)?$/.exec(path);
  const linear = /^\/providers\/linear(\/.*)?$/.exec(path);
  const model = /^\/providers\/model\/v1(\/.*)?$/.exec(path);
  let selected: OutboundCredential | null = null;
    if (bearer) {
      const credential = await new CredentialRepository(database, tenantId, env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(bearer[1]!, "bearer");
      if (!credential?.origin || !isPublicHttpsOrigin(credential.origin, env.APP_ORIGIN)) return null;
      selected = {origin: credential.origin, path: `${bearer[2] ?? "/"}${url.search}`, credential: credential.payload};
    } else if (github) {
      const installationId = Number(github[1]);
      if (!Number.isSafeInteger(installationId)) return null;
      const resolved = await resolveRunProviderCredentials({database, env, tenantId: tenantId, githubInstallationIds: [installationId], linearSelected: false});
      const credential = resolved.githubInstallations[0];
      if (!credential?.available || !credential.accessToken) return null;
      let suffix = github[2] ?? "/", origin = "https://api.github.com";
      const smart = /\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(suffix);
      if (smart) origin = "https://github.com";
      else if (suffix.startsWith("/raw/")) { origin = "https://raw.githubusercontent.com"; suffix = suffix.slice(4); }
      else if (suffix.startsWith("/archive/")) { origin = "https://codeload.github.com"; suffix = suffix.slice(8); }
      selected = {origin, path: `${suffix}${url.search}`, credential: credential.accessToken, authorization: smart ? "github-git-basic" : "bearer"};
    } else if (linear) {
      const resolved = await resolveRunProviderCredentials({database, env, tenantId: tenantId, githubInstallationIds: [], linearSelected: true});
      if (!resolved.linearConnection?.available || !resolved.linearConnection.accessToken) return null;
      selected = {origin: "https://api.linear.app", path: `${linear[1] ?? "/graphql"}${url.search}`, credential: resolved.linearConnection.accessToken};
    } else if (model) {
      const credential = await resolveManagedModelCredential({database, env, tenantId: tenantId, accountId: modelAccountId});
      if (!credential) return null;
      const suffix = model[1] ?? "/";
      const target = new URL(`${credential.origin}${credential.prefix}${suffix}`);
      if (!target.pathname.startsWith(`${credential.prefix}/`)) return null;
      selected = {origin: credential.origin, path: `${target.pathname}${url.search}`, credential: credential.accessToken,
        ...(credential.accountId ? {headers: {"chatgpt-account-id": credential.accountId}} : {})};
    }
  return selected;
}
