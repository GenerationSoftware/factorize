import { Card, Badge, buttonClasses, Page, tableCellClasses, tableClasses, tableHeadClasses, tableRowClasses, tableShellClasses } from "../../shared/ui";
import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsQuery, type JobsSearch } from "./queries";
export function JobsList() {
  const search = useSearch({ strict: false }) as JobsSearch;
  const query = useQuery(jobsQuery(search));
  return <Page >
    <div className="mb-5 flex min-w-0 items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
      <Link to="/jobs/new" className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-semibold ${buttonClasses.primary}`}>Create job</Link>
    </div>
    {query.isPending && <p role="status">Loading jobs…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.data && <>
      {!query.data.items.length && <Card className="py-12 text-center"><h2>No jobs found</h2><p className="text-sm text-slate-600 dark:text-slate-400">Create your first job or adjust your search.</p></Card>}
      {!!query.data.items.length && <div className={`${tableShellClasses} overflow-hidden`}>
        <table className={`${tableClasses} table-fixed`} aria-label="Jobs">
          <thead className={tableHeadClasses}><tr>
            <th scope="col" className={`w-24 ${tableCellClasses}`}>Status</th>
            <th scope="col" className={`w-20 ${tableCellClasses}`}>Running</th>
            <th scope="col" className={tableCellClasses}>Title</th>
          </tr></thead>
          <tbody>{query.data.items.map(job => <tr key={job.id} className={tableRowClasses}>
            <td className={`whitespace-nowrap ${tableCellClasses}`}><Badge active={job.enabled}>{job.enabled ? "Enabled" : "Disabled"}</Badge></td>
            <td className={`whitespace-nowrap ${tableCellClasses} font-mono tabular-nums ${job.runningCount > 0 ? "font-semibold text-factorize-700 dark:text-factorize-500" : "text-slate-600 dark:text-slate-400"}`}>{job.runningCount}/{job.concurrencyLimit}</td>
            <td className={tableCellClasses}><Link to="/jobs/$jobId" params={{ jobId: job.id }} title={job.name} className="block truncate font-semibold outline-none after:absolute after:inset-0 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-factorize-500">{job.name}</Link></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <nav aria-label="Job pages" className="mt-6 flex gap-4 text-sm font-semibold">
        {search.cursor && <Link to="/jobs" search={{ ...search, cursor: undefined }}>First page</Link>}
        {query.data.nextCursor && <Link to="/jobs" search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link>}
      </nav>
    </>}
  </Page>;
}
