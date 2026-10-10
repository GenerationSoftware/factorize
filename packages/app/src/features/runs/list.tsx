import { Badge, Button, buttonClasses } from "../../shared/ui";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runPageQuery } from "./queries";

export type RunListSearch = { cursor?: string; previous?: string };
const activeStates = new Set(["queued", "starting", "running", "blocked", "stopping"]);
const elapsed = (startedAt: string | null, createdAt: string) => { const start = Date.parse(startedAt ?? createdAt), seconds = Math.max(0, Math.floor((Date.now() - start) / 1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };

export function RunList({ jobId, limit = 30 }: { jobId?: string; limit?: number }) {
  const search = useSearch({ strict: false }) as RunListSearch, runs = useQuery(runPageQuery({ jobId, cursor: search.cursor, limit }));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!runs.data?.items.some(run => activeStates.has(run.state))) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [runs.data?.items]);
  const previous = search.previous?.split(",") ?? [], pageClasses = `inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${buttonClasses.secondary}`;
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
    {runs.data && <>{runs.data.items.length === 0 ? <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">{jobId ? "No runs found." : "No runs yet"}</p> : <div role="region" aria-label="Runs table" tabIndex={0} className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700"><table className="w-full text-left text-sm"><caption className="sr-only">Runs, newest first</caption><thead className="bg-stone-100 dark:bg-slate-800"><tr><th scope="col" className="px-3 py-2">Run</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Created</th>{jobId ? <th scope="col" className="px-3 py-2">Agent</th> : <th scope="col" className="px-3 py-2">Elapsed</th>}</tr></thead><tbody>{runs.data.items.map(run => <tr className="border-t border-stone-200 dark:border-slate-700" key={run.id}><td className="min-w-40 max-w-sm break-words px-3 py-2"><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }} className="font-semibold hover:text-factorize-700 dark:hover:text-factorize-500">{run.run_name || "Run"}</Link></td><td className="whitespace-nowrap px-3 py-2"><Badge active={activeStates.has(run.state)}>{run.state}</Badge></td><td className="whitespace-nowrap px-3 py-2"><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></td>{jobId ? <td className="px-3 py-2">{run.agent_kind}</td> : <td className="whitespace-nowrap px-3 py-2">{activeStates.has(run.state) ? elapsed(run.started_at, run.created_at) : "—"}</td>}</tr>)}</tbody></table></div>}</>}
    {pagination}
    <span className="sr-only" aria-live="polite">{now}</span>
  </section>;
}
