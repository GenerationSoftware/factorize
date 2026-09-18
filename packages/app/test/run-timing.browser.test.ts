// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobDetailPage, jobRunPage } from "../src/ui";

declare const document: any;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("run elapsed time", () => {
  it("uses actual start times in the job list and omits runtime before launch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:10:03Z"));
    const created_at = "2026-09-18T12:00:00Z";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/runs?") ? { items: [
        { id: "running", state: "running", created_at, started_at: "2026-09-18T12:10:00Z" },
        { id: "queued", state: "queued", created_at, started_at: null },
        { id: "legacy", state: "running", created_at, started_at: null },
      ] } : { name: "Test job", triggers: [], enabled: true, runningCount: 2, concurrencyLimit: 3 }
    ))));
    const html = jobDetailPage({ email: "test@example.com" }, "job");
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1];
    new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1])();
    await vi.advanceTimersByTimeAsync(0);
    const labels = document.querySelectorAll("[data-run-started]");
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe("3s elapsed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(labels[0].textContent).toBe("4s elapsed");
  });

  it("excludes queue time, starts after launch, and freezes on completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:10:00Z"));
    let run = { id: "run-1", job_id: "job-1", state: "queued", created_at: "2026-09-18T12:00:00Z", started_at: null as string | null, updated_at: "2026-09-18T12:00:00Z" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/trace?") ? { items: [], nextCursor: null } : url.includes("/jobs/") ? { name: "Test job" } : run
    ))));
    const html = jobRunPage({ email: "test@example.com" }, run.id);
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1];
    new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1])();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[data-run-elapsed]").textContent).toBe("Waiting to start");
    expect(document.querySelector("[data-run-queue]").textContent).toBe("600s waiting to start");
    run = { ...run, state: "running", started_at: "2026-09-18T12:10:00Z" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector("[data-run-elapsed]").textContent).toBe("3s elapsed");
    expect(document.querySelector("[data-run-queue]").textContent).toBe("600s queue time");
    run = { ...run, state: "succeeded", updated_at: "2026-09-18T12:10:05Z" };
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.querySelector("[data-run-elapsed]").textContent).toBe("5s elapsed");
  });
});
