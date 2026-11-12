import assert from "node:assert/strict";
import { test } from "node:test";
import { createOriginConnector, isPublicAddress } from "../src/destination-policy.mjs";

test("URL policy permits paths and queries only on the configured HTTPS origin", async () => {
  const calls = [];
  const connect = createOriginConnector("https://api.example.test:8443", {
    resolve: async (hostname) => {
      assert.equal(hostname, "api.example.test");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    connect: async (options) => {
      calls.push(options);
      return { remoteAddress: "93.184.216.34" };
    },
  });

  const result = await connect("https://api.example.test:8443/v1/items?limit=5");
  assert.equal(result.url.pathname, "/v1/items");
  assert.equal(result.url.search, "?limit=5");
  assert.deepEqual(calls, [{ hostname: "api.example.test", port: 8443, address: "93.184.216.34", servername: "api.example.test", timeoutMs: 10_000 }]);
});

test("rejects unsafe and malformed request URLs before resolution", async () => {
  let resolutions = 0;
  const connect = createOriginConnector("https://api.example.test", {
    resolve: async () => { resolutions += 1; return [{ address: "93.184.216.34" }]; },
    connect: async () => ({ remoteAddress: "93.184.216.34" }),
  });
  const urls = [
    "http://api.example.test/", "file://api.example.test/", "ftp://api.example.test/",
    "https://user:pass@api.example.test/", "https://api.example.test.evil.test/",
    "https://api.example.test:444/", "https://api.example.test:0/", "https://api.example.test:65536/",
    "https://api.example.test:/", "https://%61pi.example.test/", "https://2130706433/",
    "https://api.example.test\\@evil.test/", "https://[not-ipv6]/", "https://api_example.test/",
  ];
  for (const url of urls) await assert.rejects(connect(url), { name: "TypeError" }, url);
  assert.equal(resolutions, 0);
});

test("configured origin rejects credentials, paths, queries, fragments, and non-HTTPS schemes", () => {
  for (const origin of [
    "http://api.example.test", "https://user@api.example.test", "https://api.example.test/path",
    "https://api.example.test?x=1", "https://api.example.test#fragment", "https://",
  ]) assert.throws(() => createOriginConnector(origin), TypeError, origin);
});

test("encoded IPv4 authorities normalize to private IP literals and are denied", async () => {
  for (const origin of ["https://2130706433", "https://0x7f000001", "https://0177.0.0.1", "https://127.1"]) {
    const connect = createOriginConnector(origin);
    await assert.rejects(connect(`${origin}/metadata`), /non-public address/, origin);
  }
});

test("public address classification covers IPv4, IPv6, mapped and encoded ranges", () => {
  const cases = [
    ["93.184.216.34", true], ["8.8.8.8", true], ["2001:4860:4860::8888", true], ["2606:4700:4700::1111", true],
    ["0.1.2.3", false], ["10.2.3.4", false], ["100.64.0.1", false], ["127.0.0.1", false],
    ["169.254.169.254", false], ["172.16.0.1", false], ["192.168.1.1", false], ["192.0.2.10", false],
    ["198.18.0.1", false], ["198.51.100.4", false], ["203.0.113.1", false], ["224.0.0.1", false],
    ["::", false], ["::1", false], ["fc00::1", false], ["fe80::1", false], ["ff02::1", false],
    ["2001:db8::1", false], ["2002:0808:0808::1", false], ["::ffff:127.0.0.1", false],
    ["1000::1", false], ["4000::1", false],
    ["::ffff:8.8.8.8", true], ["64:ff9b::a00:1", false], ["::7f00:1", false],
  ];
  for (const [address, expected] of cases) assert.equal(isPublicAddress(address), expected, address);
  assert.equal(isPublicAddress("not-an-ip"), false);
});

test("rejects mixed public/private DNS answers and empty answers", async () => {
  for (const answers of [
    [{ address: "93.184.216.34" }, { address: "10.0.0.4" }],
    [{ address: "93.184.216.34" }, { address: "::ffff:127.0.0.1" }],
    [],
  ]) {
    let connections = 0;
    const connect = createOriginConnector("https://api.example.test", {
      resolve: async () => answers,
      connect: async () => { connections += 1; return { remoteAddress: "93.184.216.34" }; },
    });
    await assert.rejects(connect("https://api.example.test/path"));
    assert.equal(connections, 0);
  }
});

test("pins the validated address and rejects a changed connected peer", async () => {
  let resolutions = 0;
  let connectorAddress;
  const connect = createOriginConnector("https://api.example.test", {
    resolve: async () => {
      resolutions += 1;
      return [{ address: "93.184.216.34" }];
    },
    connect: async ({ address }) => {
      connectorAddress = address;
      return { remoteAddress: "8.8.4.4", destroy() { this.destroyed = true; } };
    },
  });
  await assert.rejects(connect("https://api.example.test/"), /connected peer did not match/);
  assert.equal(resolutions, 1, "the connector must not perform a second DNS resolution");
  assert.equal(connectorAddress, "93.184.216.34", "the validated address is the address given to the connector");
});

test("accepts equivalent IPv6 peer spellings after address pinning", async () => {
  const connect = createOriginConnector("https://[2606:4700:4700::1111]", {
    resolve: async () => [{ address: "2606:4700:4700:0:0:0:0:1111" }],
    connect: async () => ({ remoteAddress: "2606:4700:4700::1111" }),
  });
  await connect("https://[2606:4700:4700::1111]/health");
});

test("exact test transport retains TLS hostname/CA verification and production private-address denial", async t => {
  const { createServer } = await import('node:https');
  const { readFile } = await import('node:fs/promises');
  const { once } = await import('node:events');
  const { createTestOriginConnector } = await import('../src/destination-policy.mjs');
  const cert = await readFile(new URL('./fixtures/upstream-cert.pem', import.meta.url), 'utf8');
  const key = await readFile(new URL('./fixtures/upstream-key.pem', import.meta.url), 'utf8');
  const server = createServer({ key, cert }, (_req, res) => res.end('ok'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `https://api.example.test:${server.address().port}`;
  assert.throws(() => createTestOriginConnector({ testMode: false, origin, address: '127.0.0.1', ca: cert }));
  const factory = createTestOriginConnector({ testMode: true, origin, address: '127.0.0.1', ca: cert });
  const connected = await factory(origin)(origin + '/path'); connected.socket.destroy();
  await assert.rejects(factory('https://127.0.0.1')('https://127.0.0.1/private'), /non-public/);
  await assert.rejects(factory(origin)('https://foreign.example/path'), /mismatch/);
  const wrongOrigin = `https://wrong.example.test:${server.address().port}`;
  const wrongHost = createTestOriginConnector({ testMode: true, origin: wrongOrigin, address: '127.0.0.1', ca: cert });
  await assert.rejects(wrongHost(wrongOrigin)(wrongOrigin + '/path'), /Hostname\/IP|altnames/);
});
