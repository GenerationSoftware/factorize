import { createHash, timingSafeEqual } from "node:crypto";
import ssh2 from "ssh2";

export function generateHetznerSshKey() {
  // Reject malformed generated pairs before persisting either half.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { private: privateKey, public: publicKey } = ssh2.utils.generateKeyPairSync("ed25519");
    const parsedPrivate = ssh2.utils.parseKey(privateKey), parsedPublic = ssh2.utils.parseKey(publicKey);
    if (!(parsedPrivate instanceof Error) && !(parsedPublic instanceof Error)
        && !Array.isArray(parsedPrivate) && !Array.isArray(parsedPublic)
        && parsedPrivate.getPublicSSH().equals(parsedPublic.getPublicSSH())) return { privateKey, publicKey };
  }
  throw new Error("Could not generate a valid SSH key pair");
}

type Target = { address: string; username: string; hostFingerprint: string; privateKey: string };
const socketFailure = () => new Error("SSH authentication did not complete");

function hostKeyMatches(key: Buffer, fingerprint: string) {
  const expected = Buffer.from(fingerprint.slice("SHA256:".length), "base64");
  const actual = createHash("sha256").update(key).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Prove fresh authentication only. Never open a channel or retain a transport. */
export function authenticateHetznerSsh(target: Target, signal?: AbortSignal, port = 22): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(socketFailure()); return; }
    const client = new ssh2.Client();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", fail);
      client.destroy();
      if (ok) resolve(); else reject(socketFailure());
    };
    const fail = () => finish(false);
    const deadline = setTimeout(fail, 5000);
    signal?.addEventListener("abort", fail, { once: true });
    client.once("close", fail);
    client.on("error", fail);
    client.once("ready", () => finish(true));
    try {
      client.connect({ host: target.address, port, username: target.username, privateKey: target.privateKey,
        authHandler: ["publickey"], agentForward: false, readyTimeout: 5000,
        hostVerifier: (key: Buffer) => hostKeyMatches(key, target.hostFingerprint),
        algorithms: {
          kex: ["curve25519-sha256", "ecdh-sha2-nistp256"], serverHostKey: ["ssh-ed25519"],
          cipher: ["aes128-gcm@openssh.com", "aes256-gcm@openssh.com"],
        },
      });
    } catch { fail(); }
  });
}
