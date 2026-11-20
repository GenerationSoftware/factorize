import { Button, Card, Page, PageHeader, SortableHeader, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { triggersQuery, type TriggersSort } from "./queries";
import { TeamGraph } from "../projects/graph";

export function GlobalTriggersList() {
  const search = useSearch({ from: "/triggers" });
  return <Page className="max-w-6xl"><PageHeader title="Triggers"><Link to="/triggers/new"><Button variant="primary">Create trigger</Button></Link></PageHeader>
    <nav aria-label="Trigger views" className="mb-6 flex gap-4 border-b border-stone-200 pb-3 dark:border-slate-700">
      <Link to="/triggers" search={{ ...search, view: undefined }} aria-current={!search.view ? "page" : undefined} className={!search.view ? "font-semibold underline underline-offset-8" : ""}>Table</Link>
      <Link to="/triggers" search={{ ...search, view: "graph" }} aria-current={search.view === "graph" ? "page" : undefined} className={search.view === "graph" ? "font-semibold underline underline-offset-8" : ""}>Graph</Link>
    </nav>
    {search.view === "graph" ? <TeamGraph /> : <TriggersTable />}
  </Page>;
}

export function TriggersTable() {
  const search = useSearch({ from: "/triggers" }), navigate = useNavigate({ from: "/triggers" });
  const query = useQuery(triggersQuery(search));
  const chooseSort = (sort: TriggersSort) => void navigate({ search: { ...search, cursor: undefined, sort, order: search.sort === sort && search.order === "asc" ? "desc" : "asc" } });
  return <>
    {query.isPending && <p role="status">Loading triggers…</p>}
    {query.error && <div role="alert">{query.error.message} <Button onClick={() => void query.refetch()}>Retry</Button></div>}
    {query.data && <>
      {!query.data.items.length ? <Card><h2>No triggers yet</h2><p>Create a trigger to get started.</p></Card> : <Table aria-label="Triggers">
        <thead className={tableHeadClasses}><tr>
          <SortableHeader label="Running" ariaLabel="Running sort" active={search.sort === "running"} direction={search.order} className="w-20" onSort={() => chooseSort("running")} />
          <SortableHeader label="Title" ariaLabel="Title sort" active={search.sort === "title"} direction={search.order} onSort={() => chooseSort("title")} />
        </tr></thead>
        <tbody>{query.data.items.map(trigger => <tr key={trigger.id} className={tableRowClasses}>
          <td className={tableCellClasses}>{trigger.runningCount}/{trigger.concurrencyLimit}</td>
          <td className={tableCellClasses}><Link preload="intent" to="/triggers/$triggerId" params={{ triggerId: trigger.id }} className="font-semibold">{trigger.name}</Link>{!trigger.enabled && <span className="ml-2 text-sm">disabled</span>}</td>
        </tr>)}</tbody>
      </Table>}
      <nav aria-label="Trigger pages" className="mt-6 flex gap-4">
        {search.cursor && <Link to="/triggers" search={{ ...search, cursor: undefined }}>First page</Link>}
        {query.data.nextCursor && <Link to="/triggers" search={{ ...search, cursor: query.data.nextCursor }}>Next page</Link>}
      </nav>
    </>}
  </>;
}
