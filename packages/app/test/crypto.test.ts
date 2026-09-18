import { describe, expect, it } from "vitest";
import { base64, decrypt, encrypt } from "../src/crypto";

const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("crypto encoding", () => {
  it("preserves standard base64 output", () => {
    expect(base64("hello world")).toBe("aGVsbG8gd29ybGQ=");
    expect(base64("Factorize 🐝")).toBe("RmFjdG9yaXplIPCfkJ0=");
  });

  it("round trips a multi-megabyte Unicode transcript", async () => {
    const transcript = "agent output 🐝\n".repeat(150_000);
    const ciphertext = await encrypt(transcript, encryptionKey);
    await expect(decrypt(ciphertext, encryptionKey)).resolves.toBe(transcript);
  });
});
