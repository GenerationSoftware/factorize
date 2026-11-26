import { syncInventory } from "./inventory.mjs";
import { syncExports } from "./exports.mjs";

await syncInventory(false);
await syncExports(false);
