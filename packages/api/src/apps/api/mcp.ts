import { appRegistrationInput, appRegistrationUpdate } from "../../apps/api/apps-contracts";

import { z } from "zod";

import { mcpTool } from "../../transport/mcp/tool";

export const appTools = [
  mcpTool("apps:manage", "list_apps", "List the team's registered server-side apps. Requires apps:manage.", z.object({}), service => () => service.listApps()),
  mcpTool("apps:manage", "get_app", "Read a registered app's non-secret metadata.", z.object({appId:z.uuid()}), service => ({appId}: any) => service.getApp(appId)),
  mcpTool("apps:manage", "create_app", "Register a server-side app. Create client secrets separately in the browser.", appRegistrationInput, service => input => service.createApp(input)),
  mcpTool("apps:manage", "update_app", "Update redirect URLs, visibility, or enabled state for a registered app.", appRegistrationUpdate.extend({appId:z.uuid()}), service => ({appId,...input}: any) => service.updateApp(appId,input)),
];
