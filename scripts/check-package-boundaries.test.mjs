import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), "factorize-boundaries-"));
  try {
    for (const name of ["api", "app", "api-client"]) {
      mkdirSync(resolve(root, "packages", name, "src"), { recursive: true });
      writeFileSync(resolve(root, "packages", name, "package.json"), '{"dependencies":{}}');
      writeFileSync(resolve(root, "packages", name, "tsconfig.json"), '{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"}}');
      writeFileSync(resolve(root, "packages", name, "src", "index.ts"), 'export const value = 1;');
    }
    fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const checker = new URL("./check-package-boundaries.mjs", import.meta.url);
const check = root => spawnSync(process.execPath, [checker.pathname, root], { encoding: "utf8" });

test("isolated packages and public client import pass", () => fixture(root => {
  writeFileSync(resolve(root, "packages/app/src/index.ts"), 'import { api } from "factorize-api-client";');
  assert.equal(check(root).status, 0);
}));
for (const [name, source] of [
  ["app", 'import type { value } from "../../api/src/index";'],
  ["app", 'export * from "../../api/src/index";'],
  ["app", 'import("../../api/src/index");'],
  ["app", 'import backend = require("../../api/src/index");'],
  ["app", 'import "factorize";'],
  ["app", 'import "node:fs";'],
  ["api", 'import "../../app/src/index";'],
  ["api-client", 'import "../../api/src/index";'],
  ["app", 'import "../../api-client/src/index";'],
]) {
  test(`rejects ${name}: ${source}`, () => fixture(root => {
    writeFileSync(resolve(root, `packages/${name}/src/index.ts`), source);
    const result = check(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /forbidden|cross-package|server-only/);
  }));
}
test("resolves TypeScript aliases before enforcing boundaries", () => fixture(root => {
  writeFileSync(resolve(root, "packages/app/tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", paths: { "@server/*": ["../api/src/*"] } } }));
  writeFileSync(resolve(root, "packages/app/src/index.ts"), 'import "@server/index";');
  assert.equal(check(root).status, 1);
}));
