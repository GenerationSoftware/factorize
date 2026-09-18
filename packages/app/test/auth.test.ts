import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";

describe("credential password hashing", () => {
  it("uses the Workers-supported PBKDF2 limit and verifies only the original password", async () => {
    const encoded = await hashPassword("a sufficiently long password");
    expect(encoded).toMatch(/^pbkdf2_sha256\$100000\$/);
    await expect(verifyPassword("a sufficiently long password", encoded)).resolves.toBe(true);
    await expect(verifyPassword("a different long password", encoded)).resolves.toBe(false);
  });
});
