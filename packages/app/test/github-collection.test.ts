import { describe, expect, it, vi } from "vitest";
import { githubCollection } from "../src/github";

describe("githubCollection", () => {
  it("loads subsequent pages so all issue filter choices are available", async () => {
    const first = Array.from({ length: 100 }, (_, id) => ({ id }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(first))
      .mockResolvedValueOnce(Response.json([{ id: 100 }]));

    const result = await githubCollection<{ id: number }>("https://api.github.com/repos/acme/widgets/labels", "token", fetcher);

    expect(result).toHaveLength(101);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      "https://api.github.com/repos/acme/widgets/labels?per_page=100&page=1",
      "https://api.github.com/repos/acme/widgets/labels?per_page=100&page=2",
    ]);
  });

  it("rejects failed and malformed GitHub responses", async () => {
    await expect(githubCollection("https://api.github.com/example", "token", vi.fn().mockResolvedValue(new Response(null, { status: 403 })))).rejects.toThrow("(403)");
    await expect(githubCollection("https://api.github.com/example", "token", vi.fn().mockResolvedValue(Response.json({})))).rejects.toThrow("invalid collection");
  });
});
