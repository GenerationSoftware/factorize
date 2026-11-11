import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SAFE_VM_IDENTITY = /^[A-Za-z0-9:._-]{1,255}$/;
const SAFE_DNS_NAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;

async function openssl(args) {
  try {
    await execFile("openssl", args, { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
  } catch {
    // Never include command output or key material in errors.
    throw new Error("proxy TLS identity operation failed");
  }
}

function pem(bytes) {
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Creates a per-process private CA and proxy server identity on a memory-backed
 * filesystem. The CA private key never leaves this process or tmpfs. Job VMs
 * generate their own private keys and submit CSRs; only their signed public
 * certificate and the public trust root are returned for secure distribution.
 */
export async function createProxyTlsAuthority({ serverName, bootEpoch } = {}) {
  if (typeof serverName !== "string" || !SAFE_DNS_NAME.test(serverName)) throw new TypeError("proxy TLS server name is invalid");
  if (typeof bootEpoch !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bootEpoch)) throw new TypeError("proxy TLS boot epoch is invalid");
  const directory = await mkdtemp(join("/dev/shm", "factorize-proxy-tls-"));
  const caKeyPath = join(directory, "ca-key.pem");
  const caCertPath = join(directory, "ca-cert.pem");
  const serverKeyPath = join(directory, "server-key.pem");
  const serverCertPath = join(directory, "server-cert.pem");
  try {
    await openssl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", caKeyPath]);
    await chmod(caKeyPath, 0o600);
    await openssl(["req", "-new", "-x509", "-key", caKeyPath, "-sha256", "-days", "1", "-subj", `/CN=factorize-proxy-${bootEpoch}`, "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", caCertPath]);
    await openssl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", serverKeyPath]);
    await chmod(serverKeyPath, 0o600);
    await openssl(["req", "-new", "-key", serverKeyPath, "-subj", `/CN=${serverName}`, "-out", join(directory, "server.csr")]);
    await writeFile(join(directory, "server.ext"), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${serverName}\n`, { mode: 0o600 });
    await openssl(["x509", "-req", "-in", join(directory, "server.csr"), "-CA", caCertPath, "-CAkey", caKeyPath, "-CAcreateserial", "-days", "1", "-sha256", "-extfile", join(directory, "server.ext"), "-out", serverCertPath]);
    const ca = await readFile(caCertPath);
    const key = await readFile(serverKeyPath);
    const cert = await readFile(serverCertPath);

    let closed = false;
    return Object.freeze({
      tls: Object.freeze({ key, cert, ca }),
      trustBundle: pem(ca),
      async signVmCsr({ vmIdentity, csr } = {}) {
        if (closed) throw new Error("proxy TLS identity authority is closed");
        if (typeof vmIdentity !== "string" || !SAFE_VM_IDENTITY.test(vmIdentity)
            || typeof csr !== "string" || csr.length < 100 || csr.length > 16_384
            || !csr.startsWith("-----BEGIN CERTIFICATE REQUEST-----\n")
            || !csr.trimEnd().endsWith("-----END CERTIFICATE REQUEST-----")) {
          throw new TypeError("invalid VM certificate request");
        }
        const identityUri = `urn:factorize:vm:${Buffer.from(vmIdentity, "utf8").toString("base64url")}`;
        const csrPath = join(directory, `vm-${randomUUID()}.csr`);
        const certPath = join(directory, `vm-${randomUUID()}.pem`);
        const extensionPath = join(directory, `vm-${randomUUID()}.ext`);
        await writeFile(csrPath, csr, { mode: 0o600 });
        await writeFile(extensionPath, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyAgreement\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:${identityUri}\n`, { mode: 0o600 });
        try {
          await openssl(["req", "-in", csrPath, "-verify", "-noout"]);
          await openssl(["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath, "-CAcreateserial", "-days", "1", "-sha256", "-subj", `/CN=${vmIdentity}`, "-extfile", extensionPath, "-out", certPath]);
          return Object.freeze({ certificate: pem(await readFile(certPath)), trustBundle: pem(ca) });
        } finally {
          await Promise.all([rm(csrPath, { force: true }), rm(certPath, { force: true }), rm(extensionPath, { force: true })]);
        }
      },
      async close() {
        if (closed) return;
        closed = true;
        await rm(directory, { recursive: true, force: true });
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
