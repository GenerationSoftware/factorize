import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// workerd cannot load npm native addons or this package's dynamically compiled
// Poly1305 WASM. The Worker explicitly negotiates only OpenSSH AES-GCM.
// This build step changes no cryptographic implementation and fails closed
// if the pinned upstream module layout changes.
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("ssh2/package.json"));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== "1.17.0") throw new Error("Re-audit the Worker SSH compatibility transform.");

async function prepare(file, replacements) {
  const path = join(root, file);
  const original = await readFile(path, "utf8");
  let source = original;
  for (const [marker, before, after] of replacements) {
    if (source.includes(marker)) continue;
    if (!before.test(source)) throw new Error(`Unexpected SSH package source: ${file}`);
    source = source.replace(before, after + " /* " + marker + " */");
  }
  if (source !== original) {
    const pending = path + "." + randomUUID() + ".tmp";
    await writeFile(pending, source);
    await rename(pending, path);
  }
}
await prepare("lib/protocol/constants.js", [[
  "factorize: no native CPU detection",
  /try \{\n  cpuInfo = require\('cpu-features'\)\(\);\n\} catch \{\}/,
  "cpuInfo = undefined;",
]]);
await prepare("lib/protocol/crypto.js", [
  ["factorize: no native crypto addon",
    /try \{\n  binding = require\('\.\/crypto\/build\/Release\/sshcrypto\.node'\);[\s\S]*?\n\} catch \{\}/,
    "binding = undefined;"],
  ["factorize: no dynamic wasm", /init: \(\(\) => \{[\s\S]*?\n  \}\)\(\),/, "init: Promise.resolve(),"],
]);
await prepare("lib/agent.js", [[
  "factorize: no Windows agent",
  /const EXEPATH = resolve\(__dirname, '\.\.', 'util\/pagent\.exe'\);/,
  'const EXEPATH = "/unavailable-pagent.exe";',
]]);

// The Worker never opens an SSH channel. Remove client-side channel payload
// handling entirely so the deployed authentication-only transport does not
// retain the affected receive-window path (upstream ssh2 #1505).
await prepare("lib/client.js", [[
  "factorize: authentication-only client rejects channel payloads",
  /^        CHANNEL_DATA: \(p, recipient, data\) => \{[\s\S]*?^        CHANNEL_EXTENDED_DATA: \(p, recipient, data, type\) => \{[\s\S]*?^        \},(?=\n        CHANNEL_WINDOW_ADJUST:)/m,
  "        CHANNEL_DATA: () => this.destroy(),\n        CHANNEL_EXTENDED_DATA: () => this.destroy(),",
]]);
