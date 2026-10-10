import { Badge, Button, buttonClasses } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "./queries";
export type HistorySort = "run" | "status" | "created" | "agent";
export type HistorySearch = { cursor?: string; previous?: string; sort?: HistorySort; direction?: "asc" | "desc" };
export function RunHistory({ jobId }: { jobId: string }) {
  const search = useSearch({ strict: false }) as HistorySearch;
  const navigate = useNavigate();
  const runs = useQuery(historyQuery(jobId, search.cursor, search.sort, search.direction));
  const previous = search.previous === undefined ? [] : search.previous.split(",");
  const pageClasses = `inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${buttonClasses.secondary}`;
  const columns: Array<[HistorySort, string]> = [["run", "Run"], ["status", "Status"], ["created", "Created"], ["agent", "Agent"]];
  const sortColumn = (column: HistorySort) => {
    const direction = search.sort === column && search.direction === "asc" ? "desc" : "asc";
    void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { sort: column, direction, cursor: undefined, previous: undefined } });
  };
  const sortLabel = (column: HistorySort) => search.sort === column ? (search.direction === "desc" ? "sorted descending" : "sorted ascending") : "not sorted";
  return <section aria-label="Runs" className="my-6 min-w-0">
    {runs.isPending && <p role="status">Loading run history…</p>}{runs.error && <p role="alert">{runs.error.message} <Button onClick={() => void runs.refetch()}>Retry</Button></p>}
    {runs.data && <><div role="region" aria-label="Runs table" tabIndex={0} className="overflow-x-auto rounded-lg border border-stone-200 dark:border-slate-700">
      <table className="w-full text-left text-sm"><caption className="sr-only">Job runs{search.sort ? "" : ", newest first"}</caption>
        <thead className="bg-stone-100 dark:bg-slate-800"><tr>{columns.map(([column, label]) => <th key={column} scope="col" aria-sort={search.sort === column ? (search.direction === "desc" ? "descending" : "ascending") : "none"} className="px-3 py-2"><Button className="min-h-8 border-0 bg-transparent px-0 py-0 text-left hover:bg-transparent dark:bg-transparent" aria-label={`${label}, ${sortLabel(column)}. Activate to sort ${search.sort === column && search.direction === "asc" ? "descending" : "ascending"}`} onClick={() => sortColumn(column)}>{label}{search.sort === column && <span aria-hidden="true"> {search.direction === "desc" ? "↓" : "↑"}</span>}</Button></th>)}</tr></thead>
        <tbody>{runs.data.items.map(run => <tr className="border-t border-stone-200 dark:border-slate-700" key={run.id}>
          <td className="min-w-40 max-w-sm break-words px-3 py-2"><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }} className="font-semibold hover:text-factorize-700 dark:hover:text-factorize-500">{run.run_name || run.issue_title || "Run"}</Link></td>
          <td className="px-3 py-2"><Badge active={run.state === "running"}>{run.state}</Badge></td>
          <td className="whitespace-nowrap px-3 py-2"><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></td><td className="px-3 py-2">{run.agent_kind}</td>
        </tr>)}{runs.data.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center">No runs found.</td></tr>}</tbody>
      </table>
    </div></>}
    <nav aria-label="Run pages" className="mt-4 flex flex-wrap items-center gap-2">
      {search.cursor && <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ sort: search.sort, direction: search.direction }}>First page</Link>}
      {search.cursor && previous.length > 0 ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ sort: search.sort, direction: search.direction, cursor: previous.at(-1) || undefined, previous: previous.length > 1 ? previous.slice(0, -1).join(",") : undefined }}>Previous page</Link> : <Button disabled>Previous page</Button>}
      {runs.data?.nextCursor ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ sort: search.sort, direction: search.direction, cursor: runs.data.nextCursor, previous: [...previous, search.cursor ?? ""].join(",") }}>Next page</Link> : <Button disabled>Next page</Button>}
    </nav>
  </section>;
}
