import { Card, PageHeader, Badge, buttonClasses, Button, Input, Select, Label, Page } from "../../shared/ui";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsQuery, type JobsSearch } from "./queries";
export function JobsList() {
  const search = useSearch({ strict: false }) as JobsSearch;
  const navigate = useNavigate();
  const query = useQuery(jobsQuery(search));
  return <Page >
    <PageHeader title="Jobs" description="Your software factory. Configure prompts, connect triggers, and follow every run."><Link to="/jobs/new" className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${buttonClasses.primary}`}>Create job</Link></PageHeader>
    <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const enabled = form.get("enabled"); void navigate({ to: "/jobs", search: { q: String(form.get("q") ?? ""), enabled: enabled === "true" || enabled === "false" ? enabled : undefined, cursor: undefined } }); }} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Label>Search jobs <Input name="q" defaultValue={search.q} maxLength={120} /></Label>
      <Label>Status <Select name="enabled" defaultValue={search.enabled ?? ""}><option value="">All</option><option value="true">Enabled</option><option value="false">Disabled</option></Select></Label>
      <Button>Search</Button>
    </form>
    {query.isPending && <p role="status">Loading jobs…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.data && <>
      {!query.data.items.length && <Card className="py-12 text-center"><h2>No jobs found</h2><p className="text-sm text-slate-600 dark:text-slate-400">Create your first job or adjust your search.</p></Card>}
      <ul className="grid gap-3">{query.data.items.map(job => <li key={job.id} className="min-w-0 rounded-xl border border-stone-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="block break-words text-lg font-semibold hover:text-factorize-700 dark:hover:text-factorize-500">{job.name}</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400"><Badge active={job.enabled}>{job.enabled ? "Enabled" : "Disabled"}</Badge><span>{job.agentKind} · {job.model || "Default model"}</span><span>{job.runningCount}/{job.concurrencyLimit} running</span><Badge active={job.lastRunState === "running"}>{job.lastRunState ?? "No runs yet"}</Badge></div>
      </li>)}</ul>
      <nav aria-label="Job pages" className="mt-6 flex gap-4 text-sm font-semibold">
        {search.cursor && <Link to="/jobs" search={{ ...search, cursor: undefined }}>First page</Link>}
        {query.data.nextCursor && <Link to="/jobs" search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link>}
      </nav>
    </>}
  </Page>;
}
