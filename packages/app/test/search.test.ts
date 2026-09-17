import { describe, expect, it } from "vitest";
import { rankField, sessionExcerpt } from "../src/search";
import { scrubSession } from "../src/session-scrubber";

describe("global search", () => {
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
