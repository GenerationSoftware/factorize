import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";
import { apiWranglerCli } from "./api-wrangler.mjs";

const fromRoot = path => fileURLToPath(new URL("../" + path, import.meta.url));

function ready(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("Fixture Worker startup timed out: " + output.slice(-3000))), 30_000);
    const collect = chunk => {
      output += chunk.toString();
      if (output.includes("Ready on")) { clearTimeout(deadline); resolve(); }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", error => { clearTimeout(deadline); reject(error); });
    child.once("exit", code => { clearTimeout(deadline); reject(new Error("Fixture Worker exited: " + code + " " + output.slice(-3000))); });
  });
}

test("workerd uses fresh SSH authentication and closes without a command channel", { timeout: 55_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "factorize-ssh-test-"));
  const peers = new Set();
  let worker, server;
  try {
    const freePort = createServer();
    freePort.listen(0, "127.0.0.1");
    await once(freePort, "listening");
    const workerPort = freePort.address().port;
    await new Promise(resolve => freePort.close(resolve));
    const config = join(fixture, "wrangler.json");
    await writeFile(config, JSON.stringify({
      name: "factorize-ssh-test",
      main: fromRoot("packages/api/test/fixtures/hetzner-ssh-worker.ts"),
      compatibility_date: "2026-09-10", compatibility_flags: ["nodejs_compat"],
      durable_objects: { bindings: [{ name: "SSH_FIXTURE", class_name: "FixtureBroker" }] },
      migrations: [{ tag: "test", new_sqlite_classes: ["FixtureBroker"] }],
    }));
    const prepare = spawn(process.execPath, [fromRoot("packages/api/scripts/prepare-worker-ssh.mjs")]);
    const [prepared] = await once(prepare, "exit");
    assert.equal(prepared, 0);
    worker = spawn(process.execPath, [apiWranglerCli, "dev", "--config", config, "--local", "--port", String(workerPort),
      "--ip", "127.0.0.1", "--persist-to", fixture], { cwd: fromRoot("packages/api"), env: { ...process.env, XDG_CONFIG_HOME: fixture, XDG_CACHE_HOME: fixture }, stdio: ["ignore", "pipe", "pipe"] });
    await ready(worker);
    const url = "http://127.0.0.1:" + workerPort;
    const publicResponse = await fetch(url + "/public");
    assert.equal(publicResponse.status, 200);
    const { publicKey } = await publicResponse.json();
    const clientKey = ssh2.utils.parseKey(publicKey);
    const host = ssh2.utils.generateKeyPairSync("ed25519");
    const hostKey = ssh2.utils.parseKey(host.public);
    assert.ok(!(clientKey instanceof Error) && !(hostKey instanceof Error));
    const fingerprint = "SHA256:" + createHash("sha256").update(hostKey.getPublicSSH()).digest("base64").replace(/=+$/, "");
    let sessions = 0, channels = 0, signed = 0, allowedKey = true;
    server = new ssh2.Server({ hostKeys: [host.private], algorithms: { cipher: ["aes128-gcm@openssh.com"] } }, connection => {
      peers.add(connection); sessions++;
      connection.on("error", () => {});
      connection.on("close", () => peers.delete(connection));
      connection.on("authentication", ctx => {
        if (!allowedKey || ctx.method !== "publickey" || ctx.username !== "fixture-check" || !ctx.key.data.equals(clientKey.getPublicSSH())) return ctx.reject();
        if (ctx.signature) {
          if (clientKey.verify(ctx.blob, ctx.signature) !== true) return ctx.reject();
          signed++;
        }
        ctx.accept();
      });
      connection.on("ready", () => connection.on("session", (_accept, reject) => { channels++; reject(); }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const probe = fingerprint => fetch(url + "/probe", { method: "POST", body: JSON.stringify({ port: server.address().port, fingerprint }) });
    const first = await probe(fingerprint);
    assert.equal(first.status, 200, await first.clone().text());
    assert.deepEqual(await first.json(), { authenticated: true });
    assert.deepEqual(await (await probe(fingerprint)).json(), { authenticated: true });
    assert.equal(sessions, 2);
    assert.equal(signed, 2);
    for (let n = 0; n < 30 && peers.size; n++) await pause(20);
    assert.equal(peers.size, 0);
    allowedKey = false;
    assert.equal((await probe(fingerprint)).status, 502);
    assert.equal(signed, 2);
    assert.equal((await probe("SHA256:" + "A".repeat(43))).status, 502);
    assert.equal(channels, 0);
  } finally {
    if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill(); await exited.catch(() => {}); }
    for (const peer of peers) peer.end();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(fixture, { force: true, recursive: true });
  }
});
