import { createHash, timingSafeEqual } from "node:crypto";
import ssh2 from "ssh2";

export function generateHetznerSshKey() {
  const { private: privateKey, public: publicKey } = ssh2.utils.generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
}

type Target = { address: string; username: string; hostFingerprint: string; privateKey: string };
export type ProbableSshConnection = { check: () => Promise<void>; close: () => void };
const socketFailure = () => new Error("SSH check did not complete");

function hostKeyMatches(key: Buffer, fingerprint: string) {
  const expected = Buffer.from(fingerprint.slice("SHA256:".length), "base64");
  const actual = createHash("sha256").update(key).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function connectHetznerSsh(target: Target, onClosed: () => void, port = 22): Promise<ProbableSshConnection> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      client.end();
      client.destroy();
      onClosed();
    };
    const fail = () => { reject(socketFailure()); close(); };
    client.once("close", fail);
    client.on("error", fail);
    client.once("ready", () => resolve({
      close,
      check: () => new Promise<void>((done, failed) => {
        if (closed) { failed(socketFailure()); return; }
        const failCheck = () => { clearTimeout(timer); failed(socketFailure()); close(); };
        const timer = setTimeout(failCheck, 4000);
        // The only allowed remote operation is a fixed, no-output liveness check.
        // Never expose shell, input, argument, forwarding, or file-transfer APIs.
        client.exec("/bin/true", { pty: false }, (error, channel) => {
          if (error || closed) { failCheck(); return; }
          let outputBytes = 0;
          const consume = (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 4096) failCheck(); };
          channel.on("data", consume);
          channel.stderr.on("data", consume);
          channel.once("error", failCheck);
          channel.once("close", (code: number | undefined) => {
            clearTimeout(timer);
            if (code === 0 && !closed) done();
            else failCheck();
          });
        });
      }),
    }));
    try {
      client.connect({ host: target.address, port, username: target.username, privateKey: target.privateKey,
        authHandler: ["publickey"], agentForward: false, readyTimeout: 5000,
        hostVerifier: (key: Buffer) => hostKeyMatches(key, target.hostFingerprint),
        algorithms: {
          kex: ["curve25519-sha256", "ecdh-sha2-nistp256"],
          serverHostKey: ["ssh-ed25519"],
          cipher: ["aes128-gcm@openssh.com", "aes256-gcm@openssh.com"],
        },
      });
    } catch { fail(); }
  });
}
