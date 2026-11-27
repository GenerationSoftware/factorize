// Stable entry point for Drizzle Kit and for the runtime database adapter.
import * as identity from "./identity-schema";
import * as auth from "../auth/storage/schema";
import * as access from "../access-control/storage/schema";
import * as credentials from "../credentials/storage/schema";
import * as proxy from "../proxy/storage/schema";
import * as events from "../events/storage/schema";
import * as subscriptions from "../subscriptions/storage/schema";
import * as triggers from "../triggers/storage/schema";
import * as runtime from "../runtime/storage/schema";
import * as relations from "./schema-relations";

export { app } from "./schema-support";
export * from "./identity-schema";
export * from "../auth/storage/schema";
export * from "../access-control/storage/schema";
export * from "../credentials/storage/schema";
export * from "../credentials/storage/x-schema";
export * from "../integrations/storage/aws-schema";
export * from "../proxy/storage/schema";
export * from "../events/storage/schema";
export * from "../subscriptions/storage/schema";
export * from "../triggers/storage/schema";
export * from "../runtime/storage/schema";
export * from "./schema-relations";

// Match existing Drizzle runtime membership. The remaining exports are for
// migration tooling; their repositories use explicit SQL at runtime.
const { teamPermissionDefaults: _teamPermissionDefaults, permissionPresets: _permissionPresets, ...accessRuntime } = access;
export const databaseSchema = {
  ...identity, ...auth, ...accessRuntime, ...credentials, ...proxy, ...events, ...subscriptions, ...triggers, ...runtime,
  ...relations,
};
