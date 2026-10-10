import { Badge, Button, buttonClasses, tableCellClasses, tableClasses, tableHeadClasses, tableRowClasses, tableShellClasses } from "../../shared/ui";
import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "./queries";
export type HistorySearch = { cursor?: string; previous?: string };
export function RunHistory({ jobId }: { jobId: string }) {
  const search = useSearch({ strict: false }) as HistorySearch;
  const runs = useQuery(historyQuery(jobId, search.cursor));
  const previous = search.previous === undefined ? [] : search.previous.split(",");
  const pageClasses = `inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${buttonClasses.secondary}`;
  return <section aria-label="Runs" className="my-6 min-w-0">
    {runs.isPending && <p role="status">Loading run history…</p>}{runs.error && <p role="alert">{runs.error.message} <Button onClick={() => void runs.refetch()}>Retry</Button></p>}
    {runs.data && <><div role="region" aria-label="Runs table" tabIndex={0} className={tableShellClasses}>
      <table className={tableClasses}><caption className="sr-only">Job runs, newest first</caption>
        <thead className={tableHeadClasses}><tr><th scope="col" className={tableCellClasses}>Run</th><th scope="col" className={tableCellClasses}>Status</th><th scope="col" className={tableCellClasses}>Created</th><th scope="col" className={tableCellClasses}>Agent</th></tr></thead>
        <tbody>{runs.data.items.map(run => <tr className={tableRowClasses} key={run.id}>
          <td className={`min-w-40 max-w-sm break-words ${tableCellClasses}`}><Link to="/job-runs/$runId" params={{ runId: run.id }} search={{ after: 0 }} className="font-semibold hover:text-factorize-700 focus-visible:rounded-sm dark:hover:text-factorize-500">{run.run_name || run.issue_title || "Run"}</Link></td>
          <td className={`whitespace-nowrap ${tableCellClasses}`}><Badge active={run.state === "running"}>{run.state}</Badge></td>
          <td className={`whitespace-nowrap ${tableCellClasses}`}><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></td><td className={tableCellClasses}>{run.agent_kind}</td>
        </tr>)}{runs.data.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center">No runs found.</td></tr>}</tbody>
      </table>
    </div></>}
    <nav aria-label="Run pages" className="mt-4 flex flex-wrap items-center gap-2">
      {search.cursor && <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{}}>First page</Link>}
      {search.cursor && previous.length > 0 ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ cursor: previous.at(-1) || undefined, previous: previous.length > 1 ? previous.slice(0, -1).join(",") : undefined }}>Previous page</Link> : <Button disabled>Previous page</Button>}
      {runs.data?.nextCursor ? <Link className={pageClasses} to="/jobs/$jobId" params={{ jobId }} search={{ cursor: runs.data.nextCursor, previous: [...previous, search.cursor ?? ""].join(",") }}>Next page</Link> : <Button disabled>Next page</Button>}
    </nav>
  </section>;
}
