// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobRunPage, settingsPage } from "../src/ui";
declare const document: any;
const render = (html: string) => {
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1];
  new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1])();
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
describe("useful content loading", () => {
  it("renders a run and starts trace without requesting a full job, then keeps refreshing", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (path: string) => {
      if (path.includes("/trace?")) return Response.json({ items: [], nextCursor: null });
      if (path === "/api/v1/runs/run") return Response.json({ id: "run", job_id: "job", job_name: "My <job>", run_name: "Useful content", state: "running", created_at: new Date().toISOString(), prompt: "Run prompt" });
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetch); render(jobRunPage({ email: "owner@example.test" }, "run"));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("h1").textContent).toBe("Useful content");
    expect(document.querySelector('nav a[href="/jobs/job"]').textContent).toBe("My <job>");
    expect(document.querySelector("[data-run-prompt]").textContent).toBe("Run prompt");
    expect(fetch.mock.calls.some(([path]) => path.includes("/trace?"))).toBe(true);
    expect(fetch.mock.calls.some(([path]) => path.includes("/api/v1/jobs/"))).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch.mock.calls.filter(([path]) => path === "/api/v1/runs/run")).toHaveLength(2);
  });
  it("uses Tail installations from integration status without a duplicate read", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (path: string) => {
      if (path === "/api/v1/providers/github/installations") return Response.json([]);
      if (path === "/api/v1/integrations") return Response.json({ exeConnections: [], ampConnections: [], cloudflareTail: { installations: [{ integrationId: "tail", name: "Production" }] } });
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetch); render(settingsPage({ email: "owner@example.test" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("#installed-integrations").textContent).toContain("Production");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
