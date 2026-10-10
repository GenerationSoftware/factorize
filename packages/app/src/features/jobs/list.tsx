import { Card, buttonClasses, Page } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsQuery, type JobsOrder, type JobsSearch, type JobsSort } from "./queries";
export function JobsList() {
  const search = useSearch({ strict: false }) as JobsSearch;
  const navigate = useNavigate({ from: "/jobs" });
  const query = useQuery(jobsQuery(search));
  const sortLabel = (sort: JobsSort) => sort === "running" ? "Running" : "Title";
  const sortOrder = (sort: JobsSort): JobsOrder => search.sort === sort && search.order === "asc" ? "desc" : "asc";
  const chooseSort = (sort: JobsSort) => void navigate({ search: { ...search, cursor: undefined, sort, order: sortOrder(sort) } });
  const ariaSort = (sort: JobsSort) => search.sort !== sort ? "none" : search.order === "desc" ? "descending" : "ascending";
  return <Page >
    <div className="mb-5 flex min-w-0 items-center justify-between gap-3">
      <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
      <Link to="/jobs/new" className={`shrink-0 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-semibold ${buttonClasses.primary}`}>Create job</Link>
    </div>
    {query.isPending && <p role="status">Loading jobs…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.data && <>
      {!query.data.items.length && <Card className="py-12 text-center"><h2>No jobs found</h2><p className="text-sm text-slate-600 dark:text-slate-400">Create your first job or adjust your search.</p></Card>}
      {!!query.data.items.length && <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full table-fixed text-left text-sm" aria-label="Jobs">
          <thead className="bg-stone-100 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"><tr>
            <th scope="col" aria-sort={ariaSort("running")} className="w-20 px-2 py-2 sm:px-3"><button type="button" className="font-semibold underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:decoration-current focus-visible:outline-none" onClick={() => chooseSort("running")} aria-label={`${sortLabel("running")} sort, ${search.sort === "running" ? search.order : "not active"}`}>Running{search.sort === "running" && <span aria-hidden="true"> {search.order === "desc" ? "↓" : "↑"}</span>}</button></th>
            <th scope="col" aria-sort={ariaSort("title")} className="px-2 py-2 sm:px-3"><button type="button" className="font-semibold underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:decoration-current focus-visible:outline-none" onClick={() => chooseSort("title")} aria-label={`${sortLabel("title")} sort, ${search.sort === "title" ? search.order : "not active"}`}>Title{search.sort === "title" && <span aria-hidden="true"> {search.order === "desc" ? "↓" : "↑"}</span>}</button></th>
          </tr></thead>
          <tbody>{query.data.items.map(job => <tr key={job.id} className={`group relative border-t border-stone-200 transition-colors hover:bg-factorize-50 focus-within:bg-factorize-50 focus-within:shadow-[inset_3px_0_0_var(--color-factorize-500)] dark:border-slate-800 dark:hover:bg-factorize-500/10 dark:focus-within:bg-factorize-500/10 ${job.enabled ? "" : "text-slate-500 dark:text-slate-400"}`}>
            <td className={`whitespace-nowrap px-2 py-2 font-mono tabular-nums sm:px-3 ${job.runningCount > 0 ? "font-semibold text-factorize-700 dark:text-factorize-500" : "text-slate-600 dark:text-slate-400"}`}>{job.runningCount}/{job.concurrencyLimit}</td>
            <td className="min-w-0 px-2 py-2 sm:px-3"><div className="flex min-w-0 items-center gap-2"><Link to="/jobs/$jobId" params={{ jobId: job.id }} title={job.name} className="min-w-0 truncate font-semibold outline-none after:absolute after:inset-0 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-factorize-500">{job.name}</Link>{!job.enabled && <span className="shrink-0 rounded-full border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Disabled</span>}</div></td>
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
