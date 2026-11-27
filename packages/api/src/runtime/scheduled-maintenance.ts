import { pruneCloudflareOAuth } from "../integrations/providers/cloudflare-oauth";

import { pruneTotp } from "../auth/application/totp";

import { clearExpiredGoogleSignIns } from "../auth/application/google-sign-in";

import { pruneRevokedMcpSubscriptions } from "../subscriptions/storage/mcp-event-outbox";
import { wakeMcpDeliveries } from "../subscriptions/application/wake-delivery";

import type { Env } from "../types";

import { databaseFor } from "../postgres/database";

import { pruneAccessControl, pruneBrowserSessions } from "../access-control/storage/maintenance";
import { pruneVmGrants } from "../vm-grants/storage/maintenance";

export async function runScheduledMaintenance(env: Env) {
    // Ensure the alarm sweep starts even if a producer's immediate wake was missed.
    await wakeMcpDeliveries(env).catch(() => {});
    const db = databaseFor(env);
    await pruneRevokedMcpSubscriptions(db);
    await pruneAccessControl(db);
    // Retire expired VM proofs and incomplete enrollments.
    await clearExpiredGoogleSignIns(db.pool);
    await pruneCloudflareOAuth(db.pool);
    await pruneTotp(db.pool);
    await pruneBrowserSessions(db);
    await pruneVmGrants(db);
}
