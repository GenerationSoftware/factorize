import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const requireApi = createRequire(new URL("../packages/api/package.json", import.meta.url));
export const apiWranglerCli = join(dirname(requireApi.resolve("wrangler/package.json")), "bin/wrangler.js");
