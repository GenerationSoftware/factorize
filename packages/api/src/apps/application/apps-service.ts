import { decideOidcConsent, inspectOidcConsent, oidcConsentInput, oidcConsentPreview } from "../../oidc-provider";
import { AppsRepository } from "../storage/apps-repository";
import { appRegistrationInput, appRegistrationUpdate, appSecret, connectedApp, registeredApp } from "../api/apps-contracts";

import { z } from "zod";

import type { Env, OAuthProps } from "../../types";
import { databaseFor } from "../../postgres/database";

import { AGENT_SCOPES } from "../../access-tokens";
import { ServiceError, publicValue } from "../../service-contract";

export class AppsService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>, private authorizeOwnerSession: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  private apps() { return new AppsRepository(databaseFor(this.env), this.auth.tenantId); }

  async inspectAppConsent(requestId: string) {
    await this.authorizeOwnerSession("team:read");
    const preview = await inspectOidcConsent(this.env, this.auth, requestId);
    if (!preview) throw new ServiceError(404, "not_found", "App sign-in request is unavailable.");
    return publicValue(oidcConsentPreview, preview);
  }

  async decideAppConsent(body: unknown) {
    await this.authorizeOwnerSession("team:read");
    const redirectTo = await decideOidcConsent(this.env, this.auth, oidcConsentInput.parse(body));
    if (!redirectTo) throw new ServiceError(404, "not_found", "App sign-in request is unavailable.");
    return { redirectTo };
  }

  async listApps() {
    await this.authorize("apps:manage");
    return publicValue(z.array(registeredApp), await this.apps().list());
  }

  async getApp(id: string) {
    await this.authorize("apps:manage");
    const value = await this.apps().find(id);
    if (!value) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(registeredApp, value);
  }

  async createApp(body: unknown) {
    await this.authorize("apps:manage");
    return publicValue(registeredApp, await this.apps().create(appRegistrationInput.parse(body)));
  }

  async updateApp(id: string, body: unknown) {
    await this.authorize("apps:manage");
    const value = await this.apps().update(id, appRegistrationUpdate.parse(body));
    if (!value) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(registeredApp, value);
  }

  async rotateAppSecret(id: string) {
    await this.authorizeOwnerSession("apps:manage");
    const secret = await this.apps().rotateSecret(id);
    if (!secret) throw new ServiceError(404, "not_found", "App not found.");
    return publicValue(appSecret, secret);
  }

  async listConnectedApps() {
    await this.authorizeOwnerSession("team:read");
    return publicValue(z.array(connectedApp), await this.apps().connected(this.auth.userId));
  }

  async revokeConnectedApp(id: string) {
    await this.authorizeOwnerSession("team:write");
    if (!await this.apps().revoke(this.auth.userId, id)) throw new ServiceError(404, "not_found", "App connection not found.");
    return { ok: true };
  }
}
