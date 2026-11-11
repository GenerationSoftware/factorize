import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let server;
let origin;
const sourceUrl = new URL("../../src/lib/unlock-crypto.ts", import.meta.url);

test.beforeAll(async () => {
  const source = await readFile(sourceUrl, "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  server = createServer(async (req, res) => {
    if (new URL(req.url, "http://fixture").pathname === "/unlock-crypto.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(javascript);
      return;
    }
    try {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await readFile(new URL("../../dist/index.html", import.meta.url)));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("versioned unlock-key vector and encryption round-trip work in Chromium", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { decryptRecord, encryptRecord, generateUnlockKey } = await import("/unlock-crypto.js");
    const key = "fzk1.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const binding = { ownerId: "owner-vector", recordId: "record-vector", recordType: "integration", destination: "https://api.example.test", revision: 7 };
    const vector = { version: 1, algorithm: "A256GCM", nonce: "oKGio6Slpqeoqaqr", ciphertext: "zD4d7Hr-kv60Kj8vOX_XeLVnruqK8LoNWu2elYJASCVrEhv7qecotw" };
    const decoded = new TextDecoder().decode(await decryptRecord(vector, key, binding));
    const generated = generateUnlockKey();
    const envelope = await encryptRecord(new TextEncoder().encode("browser round trip"), generated, binding);
    const roundTrip = new TextDecoder().decode(await decryptRecord(envelope, generated, binding));
    return { decoded, roundTrip, nonceLength: atob(envelope.nonce.replaceAll("-", "+").replaceAll("_", "/")).length };
  });
  expect(result).toEqual({ decoded: "synthetic vector payload", roundTrip: "browser round trip", nonceLength: 12 });
});
