import { Badge, Button, buttonClasses, SortableHeader, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runPageQuery, type RunPageSort } from "./queries";

export type RunListSearch = { cursor?: string; previous?: string; sort?: RunPageSort; direction?: "asc" | "desc" };
const activeStates = new Set(["queued", "starting", "running", "blocked", "stopping"]);
const elapsed = (startedAt: string | null, createdAt: string) => { const start = Date.parse(startedAt ?? createdAt), seconds = Math.max(0, Math.floor((Date.now() - start) / 1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };

export function RunList({ jobId, limit = 30 }: { jobId?: string; limit?: number }) {
  const search = useSearch({ strict: false }) as RunListSearch, navigateRuns = useNavigate({ from: "/job-runs" }), navigateJob = useNavigate({ from: "/jobs/$jobId" }), runs = useQuery(runPageQuery({ jobId, cursor: search.cursor, limit, sort: search.sort, direction: search.direction }));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!runs.data?.items.some(run => activeStates.has(run.state))) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [runs.data?.items]);
  const previous = search.previous?.split(",") ?? [], pageClasses = `inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${buttonClasses.secondary}`;
  const columns: Array<[RunPageSort, string]> = [["run", "Run"], ["status", "Status"], ["created", "Created"], ...(jobId ? [["agent", "Agent"] as [RunPageSort, string]] : [])];
  const sortColumn = (column: RunPageSort) => {
    const nextSearch = { ...search, sort: column, direction: search.sort === column && search.direction === "asc" ? "desc" : "asc", cursor: undefined, previous: undefined };
    if (jobId) void navigateJob({ search: nextSearch });
    else void navigateRuns({ search: nextSearch });
  };
  const pagination = jobId ? <nav aria-label="Run pages" className="mt-4 flex flex-wrap items-center gap-2">
    {search.cursor && <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{}}>First page</Link>}
    {search.cursor && previous.length > 0 ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ cursor: previous.at(-1) || undefined, previous: previous.length > 1 ? previous.slice(0, -1).join(",") : undefined }}>Previous page</Link> : <Button disabled>Previous page</Button>}
    {runs.data?.nextCursor ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ cursor: runs.data.nextCursor, previous: [...previous, search.cursor ?? ""].join(",") }}>Next page</Link> : <Button disabled>Next page</Button>}
  </nav> : <nav aria-label="Run pages" className="mt-4 flex flex-wrap items-center gap-2">
    {search.cursor && <Link className={pageClasses} to="/job-runs" search={{}}>First page</Link>}
    {search.cursor && previous.length > 0 ? <Link className={pageClasses} to="/job-runs" search={{ cursor: previous.at(-1), previous: previous.length > 1 ? previous.slice(0, -1).join(",") : undefined }}>Previous page</Link> : <Button disabled>Previous page</Button>}
    {runs.data?.nextCursor ? <Link className={pageClasses} to="/job-runs" search={{ cursor: runs.data.nextCursor, previous: [...previous, search.cursor ?? ""].join(",") }}>Next page</Link> : <Button disabled>Next page</Button>}
  </nav>;
  return <section aria-label="Runs" className="my-6 min-w-0">
    {runs.isPending && <p role="status">Loading runs…</p>}{runs.error && <p role="alert">{runs.error.message} <Button onClick={() => void runs.refetch()}>Retry</Button></p>}
    {runs.data && <>{runs.data.items.length === 0 && jobId ? <Table shellProps={{ role: "region", "aria-label": "Runs table", tabIndex: 0 }}><tbody><tr><td colSpan={4} className={tableCellClasses + " py-6 text-center"}>No runs found.</td></tr></tbody></Table> : runs.data.items.length === 0 ? <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">No runs yet</p> : <Table shellProps={{ role: "region", "aria-label": "Runs table", tabIndex: 0 }}><caption className="sr-only">Runs{search.sort ? "" : ", newest first"}</caption><thead className={tableHeadClasses}><tr>{columns.map(([column, label]) => <SortableHeader key={column} label={label} active={search.sort === column} direction={search.direction} onSort={() => sortColumn(column)} />)}{!jobId && <th scope="col" className={tableCellClasses}>Elapsed</th>}</tr></thead><tbody>{runs.data.items.map(run => <tr className={tableRowClasses} key={run.id}><td className={`min-w-40 max-w-sm break-words ${tableCellClasses}`}><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }} className="font-semibold hover:text-factorize-700 dark:hover:text-factorize-500">{run.run_name || "Run"}</Link></td><td className={`whitespace-nowrap ${tableCellClasses}`}><Badge active={activeStates.has(run.state)}>{run.state}</Badge></td><td className={`whitespace-nowrap ${tableCellClasses}`}><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></td>{jobId ? <td className={tableCellClasses}>{run.agent_kind}</td> : <td className={`whitespace-nowrap ${tableCellClasses}`}>{activeStates.has(run.state) ? elapsed(run.started_at, run.created_at) : "—"}</td>}</tr>)}</tbody></Table>}</>}
    {pagination}
    <span className="sr-only" aria-live="polite">{now}</span>
  </section>;
}
