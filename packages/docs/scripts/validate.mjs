import { checkContent } from "./content.mjs";
import { syncExports } from "./exports.mjs";

await checkContent();
await syncExports(true);
console.log("Validated documentation navigation/links, MCP inventory and generated exports.");
