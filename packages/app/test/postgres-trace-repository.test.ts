import { describe, expect, it, vi } from "vitest";
import { TraceRepository } from "../src/postgres/trace-repository";

describe("TraceRepository", () => {
  it("uses tenant/run keyset pagination and caps page size", async () => {
    const query = vi.fn(async () => ({ rows: Array.from({ length: 201 }, (_, index) => ({ sequence: index + 11, id: `e${index}`, parent_id: null, event_type: "tool_call", role: null, title: "Read", preview_text: "x", display_data: {}, occurred_at: null })), rowCount: 201 }));
    const database = { pool: { query } } as any;
    const page = await new TraceRepository(database, "tenant-1").page("run-1", 10, 999);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("sequence>$3"), ["tenant-1", "run-1", 10, 201]);
    expect(page.items).toHaveLength(200);
    expect(page.nextCursor).toBe(210);
  });
});
