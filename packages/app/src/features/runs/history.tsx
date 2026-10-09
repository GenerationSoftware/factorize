import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "./queries";
export type HistorySearch = { cursor?: string; state?: "queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped"; contextQuery?: string };
export function RunHistory({ jobId }: { jobId: string }) {
  const search = useSearch({ strict: false }) as HistorySearch, navigate = useNavigate(), runs = useQuery(historyQuery(jobId, search.cursor, search.state, search.contextQuery));
  return <section className="my-6"><h2 className="text-xl font-semibold">Run history</h2><form className="my-4 flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { state: String(data.get("state") || "") || undefined, contextQuery: String(data.get("contextQuery") || "") || undefined, cursor: undefined } }); }}><label>Run state <select name="state" defaultValue={search.state ?? ""}><option value="">All states</option>{["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped"].map(state => <option key={state}>{state}</option>)}</select></label><label>Search run context <input name="contextQuery" maxLength={50_000} defaultValue={search.contextQuery} /></label><button>Search runs</button></form>
    {runs.isPending && <p role="status">Loading run history…</p>}{runs.error && <p role="alert">{runs.error.message}</p>}{runs.data?.items.length === 0 && <p>No runs found.</p>}
    <ul>{runs.data?.items.map(run => <li className="my-3" key={run.id}><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }}>{run.run_name || run.issue_title || "Run"}</Link><p>{run.state} · {run.created_at} · {run.agent_kind}</p></li>)}</ul>
    <nav aria-label="Run pages">{search.cursor && <Link to="/jobs/$jobId" params={{ jobId }} search={{ ...search, cursor: undefined }}>First run page</Link>}{runs.data?.nextCursor && <Link to="/jobs/$jobId" params={{ jobId }} search={{ ...search, cursor: runs.data.nextCursor }}>Next run page</Link>}</nav>
  </section>;
}
