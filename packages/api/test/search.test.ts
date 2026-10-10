import { describe, expect, it, vi } from "vitest";
import { rankField, sessionExcerpt } from "../src/search";
import { scrubSession } from "../src/session-scrubber";
import { OperationsRepository } from "../src/postgres/operations-repository";

describe("global search", () => {
  it("finds a hyphenated identifier in a longer run name within the tenant", async () => {
    const query = vi.fn(async () => ({ rows: [{
      kind: "run", id: "run-id", title: "GEN-2310: PR #222: fix failed Test and validate Workers check (450b8cc6)",
      subtitle: "succeeded", url: "/job-runs/run-id", source_id: "run-id", source_label: "GEN-2310: PR #222: fix failed Test and validate Workers check (450b8cc6)",
      match_text: "GEN-2310: PR #222: fix failed Test and validate Workers check (450b8cc6)",
    }] }));
    const repository = new OperationsRepository({ pool: { query } } as any, "authorized-tenant");

    await expect(repository.search("GEN-2310")).resolves.toMatchObject({ items: [{ kind: "run", id: "run-id" }] });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("$2 <% r.run_name");
    expect(sql).toContain("r.tenant_id=$1");
    expect(values).toEqual(["authorized-tenant", "gen-2310"]);
  });

  it("ranks exact metadata before contiguous and session matches", () => {
    expect(rankField("Dispatch after GEN-2098 update", "gen-2098", "run_name")?.score).toBe(1);
    expect(rankField("GEN-2098", "gen-2098", "issue_id")?.score).toBe(0);
    expect(rankField("notes mention GEN-2098", "gen-2098", "session")?.score).toBe(2);
  });
  it("matches ordered query characters across gaps", () => {
    const match = rankField("Dispatch after GEN-2098 update", "gen2098", "run_name");
    expect(match?.score).toBe(2);
    expect(match?.range).toEqual({ start: 15, end: 23 });
  });
  it("creates bounded transcript excerpts", () => {
    const value = "a".repeat(100) + " GEN-2098 " + "b".repeat(100);
    expect(sessionExcerpt(value, { start: 101, end: 108 }, 10)).toContain("GEN-2098");
    expect(sessionExcerpt(value, { start: 101, end: 108 }, 10).length).toBeLessThan(40);
  });
});

describe("session scrubber", () => {
  it("redacts provider credentials before persistence", () => {
    const value = scrubSession("ghp_abcdefghijklmnopqrstuvwxyz and Bearer abc.def.ghi\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----");
    expect(value).not.toContain("ghp_");
    expect(value).not.toContain("abc.def.ghi");
    expect(value).toContain("[REDACTED]");
  });
});
