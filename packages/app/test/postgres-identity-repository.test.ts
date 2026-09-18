import { describe, expect, it, vi } from "vitest";
import { IdentityRepository } from "../src/postgres/identity-repository";

describe("IdentityRepository", () => {
  it("tenant-qualifies member reads", async () => {
    const query = vi.fn(async () => ({ rows: [{ user_id: "u1", email: "a@b.test", role: "owner", session_version: 3 }], rowCount: 1 }));
    const repository = new IdentityRepository({ pool: { query } } as any, "t1");
    await expect(repository.member("u1")).resolves.toEqual({ userId: "u1", email: "a@b.test", role: "owner", sessionVersion: 3 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("tenant_id=$1"), ["t1", "u1"]);
  });
});
