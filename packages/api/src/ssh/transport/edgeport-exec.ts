import { createHash, timingSafeEqual } from "node:crypto";
import { connect, type SshSession } from "edgeport/ssh";
import type { SshTarget } from "../api/contracts";

export const SSH_CONNECT_MS = 5_000;
export const SSH_COMMAND_MS = 20_000;
const OUTPUT_LIMIT = 32 * 1024;

export function openSshSession(target: SshTarget, privateKey: string, port = 22) {
  const expected = Buffer.from(target.hostFingerprint.slice("SHA256:".length), "base64");
  return connect({
    hostname: target.address, port, username: target.username, privateKey: { pem: privateKey },
    timeoutMs: SSH_CONNECT_MS,
    hostKey: { verify: (type, wireKey) => type === "ssh-ed25519" &&
      timingSafeEqual(expected, createHash("sha256").update(wireKey).digest()) },
  });
}

export async function execBounded(session: SshSession, command: string) {
  const channel = await session.execStream(command);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader(), buffer = new Uint8Array(OUTPUT_LIMIT);
    let size = 0, truncated = false;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        const take = Math.min(OUTPUT_LIMIT - size, result.value.length);
        if (take < result.value.length) truncated = true;
        buffer.set(result.value.subarray(0, take), size);
        size += take;
      }
      return { text: new TextDecoder().decode(buffer.subarray(0, size)), truncated };
    } finally { reader.releaseLock(); }
  };
  try {
    const [stdout, stderr, exit] = await Promise.all([read(channel.stdout), read(channel.stderr), channel.exit, channel.eof()]);
    return { stdout: stdout.text, stderr: stderr.text, exitCode: exit.code, signal: exit.signal, truncated: stdout.truncated || stderr.truncated };
  } finally { await channel.close(); }
}
