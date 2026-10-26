import { Button, Card, MultiSelectHeader, SortableHeader, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsQuery, type JobsOrder, type JobsSearch, type JobsSort } from "./queries";
import { projectsQuery } from "../projects/queries";
import { Page, PageHeader } from "../../shared/ui";

export function GlobalJobsList() {
  const search = useSearch({ from: "/jobs" });
  return <Page className="max-w-6xl"><PageHeader title="Jobs" description="Configure and monitor jobs across your projects."><Link to="/jobs/new" search={{ projectId: search.projectId }}><Button variant="primary">Create job</Button></Link></PageHeader><div className="mb-5 flex justify-end"><Link to="/projects" className="text-sm font-semibold underline underline-offset-4">Manage projects</Link></div><JobsTable projectId={search.projectId} global /></Page>;
}

export function JobsTable({ projectId, global = false }: { projectId?: string; global?: boolean }) {
  const search = useSearch({ strict: false }) as JobsSearch;
  const globalNavigate = useNavigate({ from: "/jobs" });
  const projectNavigate = useNavigate({ from: "/projects/$projectId" });
  const query = useQuery(jobsQuery({ ...search, projectId }));
  const projects = useQuery({ ...projectsQuery, enabled: global });
  const sortLabel = (sort: JobsSort) => sort === "running" ? "Running" : "Title";
  const sortOrder = (sort: JobsSort): JobsOrder => search.sort === sort && search.order === "asc" ? "desc" : "asc";
  const chooseSort = (sort: JobsSort) => void (global ? globalNavigate : projectNavigate)({ search: { ...search, cursor: undefined, sort, order: sortOrder(sort) } });
  return <>
    {query.isPending && <p role="status">Loading jobs…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.data && <>
      {!query.data.items.length && <Card className="py-12 text-center"><h2>{global && !projectId ? "No jobs yet" : "No jobs in this project yet."}</h2><p className="text-sm text-slate-600 dark:text-slate-400">{global && !projectId ? "Create a job to get started." : "Create your first job to get started."}</p></Card>}
      {!!query.data.items.length && <Table className="table-fixed" aria-label="Jobs">
        <thead className={tableHeadClasses}><tr>
          <SortableHeader label="Running" ariaLabel={`${sortLabel("running")} sort`} active={search.sort === "running"} direction={search.order} className="w-20" onSort={() => chooseSort("running")} />
          {global && <MultiSelectHeader label="Project" options={(projects.data ?? []).map(project => ({ id: project.id, label: project.name }))} selected={projectId ? [projectId] : []} onChange={(id, checked) => void globalNavigate({ search: { ...search, projectId: checked ? id : undefined, cursor: undefined } })} onClear={() => void globalNavigate({ search: { ...search, projectId: undefined, cursor: undefined } })} />}
          <SortableHeader label="Title" ariaLabel={`${sortLabel("title")} sort`} active={search.sort === "title"} direction={search.order} onSort={() => chooseSort("title")} />
        </tr></thead>
        <tbody>{query.data.items.map(job => <tr key={job.id} className={`${tableRowClasses} ${job.enabled ? "" : "text-slate-500 dark:text-slate-500"}`}>
          <td className={`whitespace-nowrap ${tableCellClasses} font-mono tabular-nums ${job.enabled && job.runningCount > 0 ? "font-semibold text-factorize-700 dark:text-factorize-500" : job.enabled ? "text-slate-600 dark:text-slate-400" : ""}`}>{job.runningCount}/{job.concurrencyLimit}</td>
          {global && <td className={`${tableCellClasses} max-w-0`}>{projects.data?.find(project => project.id === job.projectId) ? <Link className="block truncate font-semibold hover:text-factorize-700" to="/projects/$projectId" params={{ projectId: job.projectId }}>{projects.data.find(project => project.id === job.projectId)!.name}</Link> : <span className="text-slate-500">—</span>}</td>}
          <td className={tableCellClasses}><div className="relative flex min-w-0 items-center gap-2"><Link to="/jobs/$jobId" params={{ jobId: job.id }} title={job.name} className="relative min-w-0 flex-1 truncate font-semibold outline-none after:absolute after:inset-0 focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-factorize-500">{job.name}</Link>{!job.enabled && <span className="shrink-0 text-xs font-medium lowercase tracking-wide">disabled</span>}</div></td>
        </tr>)}</tbody>
      </Table>}
      <nav aria-label="Job pages" className="mt-6 flex gap-4 text-sm font-semibold">
        {search.cursor && (global ? <Link to="/jobs" search={{ ...search, cursor: undefined }}>First page</Link> : <Link to="/projects/$projectId" params={{ projectId: projectId! }} search={{ ...search, cursor: undefined }}>First page</Link>)}
        {query.data.nextCursor && (global ? <Link to="/jobs" search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link> : <Link to="/projects/$projectId" params={{ projectId: projectId! }} search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link>)}
      </nav>
    </>}
  </>;
}
