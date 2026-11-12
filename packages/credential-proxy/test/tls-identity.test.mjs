import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { createProxyTlsAuthority } from "../src/tls-identity.mjs";

const execFile = promisify(execFileCallback);
const bootEpoch = "11111111-1111-4111-8111-111111111111";

test("proxy TLS authority provisions a boot-bound server cert and signs only canonical VM identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factorize-tls-test-"));
  const authority = await createProxyTlsAuthority({ serverName: "proxy.internal.test", bootEpoch });
  try {
    const keyPath = join(directory, "vm-key.pem");
    const csrPath = join(directory, "vm.csr");
    await execFile("openssl", ["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", keyPath]);
    await execFile("openssl", ["req", "-new", "-key", keyPath, "-subj", "/CN=ignored-by-issuer", "-out", csrPath]);
    const csr = await readFile(csrPath, "utf8");
    const issued = await authority.signVmCsr({ vmIdentity: "fly:machine-7", csr });
    assert.equal(issued.trustBundle, authority.trustBundle);
    assert.match(issued.certificate, /BEGIN CERTIFICATE/);
    await writeFile(join(directory, "root.pem"), issued.trustBundle, { mode: 0o600 });
    await writeFile(join(directory, "client.pem"), issued.certificate, { mode: 0o600 });
    await execFile("openssl", ["verify", "-CAfile", join(directory, "root.pem"), join(directory, "client.pem")]);
    const { stdout: clientText } = await execFile("openssl", ["x509", "-in", join(directory, "client.pem"), "-noout", "-subject", "-ext", "subjectAltName"]);
    assert.match(clientText, /CN\s*=\s*fly:machine-7/);
    assert.match(clientText, /URI:urn:factorize:vm:Zmx5Om1hY2hpbmUtNw/);
    const { stdout: usageText } = await execFile("openssl", ["x509", "-in", join(directory, "client.pem"), "-noout", "-ext", "extendedKeyUsage"]);
    assert.match(usageText, /TLS Web Client Authentication/);

    await writeFile(join(directory, "server.pem"), authority.tls.cert, { mode: 0o600 });
    await writeFile(join(directory, "server-root.pem"), authority.tls.ca, { mode: 0o600 });
    await execFile("openssl", ["verify", "-CAfile", join(directory, "server-root.pem"), "-verify_hostname", "proxy.internal.test", join(directory, "server.pem")]);
    await assert.rejects(authority.signVmCsr({ vmIdentity: "../machine", csr }), /invalid VM certificate request/);
    await assert.rejects(authority.signVmCsr({ vmIdentity: "fly:machine-7", csr: "not a CSR" }));
    await authority.close();
    await assert.rejects(authority.signVmCsr({ vmIdentity: "fly:machine-7", csr }), /authority is closed/);
  } finally {
    await authority.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("proxy TLS authority rejects malformed server names and boot identities", async () => {
  await assert.rejects(createProxyTlsAuthority({ serverName: "https://proxy.test", bootEpoch }));
  await assert.rejects(createProxyTlsAuthority({ serverName: "proxy.test", bootEpoch: "old" }));
});
