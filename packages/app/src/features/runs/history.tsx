import { Button, RunStatusDot, buttonClasses, SortableHeader, StatusHeader, type RunStatus, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "./queries";
export type HistorySort = "run" | "status" | "created" | "agent";
export type HistorySearch = { cursor?: string; previous?: string; states?: RunStatus[]; sort?: HistorySort; direction?: "asc" | "desc" };
export function RunHistory({ jobId }: { jobId: string }) {
  const search = useSearch({ strict: false }) as HistorySearch;
  const navigate = useNavigate();
  const runs = useQuery(historyQuery(jobId, search.cursor, search.sort, search.direction, search.states));
  const previous = search.previous === undefined ? [] : search.previous.split(",");
  const pageClasses = `inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${buttonClasses.secondary}`;
  const columns: Array<[HistorySort, string]> = [["status", "Status"], ["run", "Run"], ["created", "Created"]];
  const sortColumn = (column: HistorySort) => {
    const direction = search.sort === column && search.direction === "asc" ? "desc" : "asc";
    void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { sort: column, direction, cursor: undefined, previous: undefined } });
  };
  const sortLabel = (column: HistorySort) => search.sort === column ? (search.direction === "desc" ? "sorted descending" : "sorted ascending") : "not sorted";
  const changeFilter = (status: RunStatus, checked: boolean) => { const states = new Set(search.states ?? []); checked ? states.add(status) : states.delete(status); void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { ...search, states: [...states], cursor: undefined, previous: undefined } }); };
  const changeStatusSort = (direction?: "asc" | "desc") => void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { ...search, sort: direction ? "status" : undefined, direction, cursor: undefined, previous: undefined } });
  const clearStatuses = () => void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { ...search, states: [], sort: undefined, direction: undefined, cursor: undefined, previous: undefined } });
  return <section aria-label="Runs" className="my-6 min-w-0">
    {runs.isPending && <p role="status">Loading run history…</p>}{runs.error && <p role="alert">{runs.error.message} <Button onClick={() => void runs.refetch()}>Retry</Button></p>}
    {runs.data && <><Table shellProps={{ role: "region", "aria-label": "Runs table", tabIndex: 0 }}><caption className="sr-only">Job runs{search.sort ? "" : ", newest first"}</caption>
        <thead className={tableHeadClasses}><tr><StatusHeader selected={search.states ?? []} sortDirection={search.sort === "status" ? search.direction : undefined} onFilterChange={changeFilter} onSortChange={changeStatusSort} onClear={clearStatuses} />{columns.slice(1).map(([column, label]) => <SortableHeader key={column} label={label} active={search.sort === column} direction={search.direction} ariaLabel={`${label}, ${sortLabel(column)}`} onSort={() => sortColumn(column)} />)}</tr></thead>
        <tbody>{runs.data.items.map(run => <tr className={tableRowClasses} key={run.id}>
          <td className={`whitespace-nowrap ${tableCellClasses}`}><RunStatusDot state={run.state} /></td>
          <td className={`min-w-40 max-w-sm break-words ${tableCellClasses}`}><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }} className="font-semibold hover:text-factorize-700 focus-visible:rounded-sm dark:hover:text-factorize-500">{run.run_name || run.issue_title || "Run"}</Link></td>
          <td className={`whitespace-nowrap ${tableCellClasses}`}><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></td>
        </tr>)}{runs.data.items.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center">{search.states?.length ? <><p>No runs match the selected statuses.</p><Button className="mt-3" onClick={() => void navigate({ to: "/jobs/$jobId", params: { jobId }, search: { ...search, states: [], cursor: undefined, previous: undefined } })}>Clear status filters</Button></> : "No runs found."}</td></tr>}</tbody>
      </Table></>}
    <nav aria-label="Run pages" className="mt-4 flex flex-wrap items-center gap-2">
      {search.cursor && <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ states: search.states, sort: search.sort, direction: search.direction }}>First page</Link>}
      {search.cursor && previous.length > 0 ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ states: search.states, sort: search.sort, direction: search.direction, cursor: previous.at(-1) || undefined, previous: previous.length > 1 ? previous.slice(0, -1).join(",") : undefined }}>Previous page</Link> : <Button disabled>Previous page</Button>}
      {runs.data?.nextCursor ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ states: search.states, sort: search.sort, direction: search.direction, cursor: runs.data.nextCursor, previous: [...previous, search.cursor ?? ""].join(",") }}>Next page</Link> : <Button disabled>Next page</Button>}
    </nav>
  </section>;
}
