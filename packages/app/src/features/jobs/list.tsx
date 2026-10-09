import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsQuery, type JobsSearch } from "./queries";
export function JobsList() {
  const search = useSearch({ strict: false }) as JobsSearch;
  const navigate = useNavigate();
  const query = useQuery(jobsQuery(search));
  return <main className="mx-auto max-w-5xl p-6">
    <h1 className="text-3xl font-semibold">Jobs</h1>
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const enabled = form.get("enabled"); void navigate({ to: "/jobs", search: { q: String(form.get("q") ?? ""), enabled: enabled === "true" || enabled === "false" ? enabled : undefined, cursor: undefined } }); }} className="my-4 flex flex-wrap gap-3">
      <label>Search jobs <input name="q" defaultValue={search.q} maxLength={120} /></label>
      <label>Status <select name="enabled" defaultValue={search.enabled ?? ""}><option value="">All</option><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
      <button>Search</button>
    </form>
    {query.isPending && <p role="status">Loading jobs…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.data && <>
      {!query.data.items.length && <p>No jobs found.</p>}
      <ul className="divide-y">{query.data.items.map(job => <li key={job.id} className="py-4">
        <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="font-semibold underline">{job.name}</Link>
        <p>{job.enabled ? "Enabled" : "Disabled"} · {job.runningCount}/{job.concurrencyLimit} running · {job.lastRunState ?? "No runs yet"}</p>
      </li>)}</ul>
      <nav aria-label="Job pages" className="flex gap-4">
        {search.cursor && <Link to="/jobs" search={{ ...search, cursor: undefined }}>First page</Link>}
        {query.data.nextCursor && <Link to="/jobs" search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link>}
      </nav>
    </>}
  </main>;
}
