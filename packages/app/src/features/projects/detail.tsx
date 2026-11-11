import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../shared/ui";
import { JobsTable } from "../jobs/list";
import { ProjectGraph } from "./graph";
import { projectQuery } from "./queries";
import { ProjectNav } from "./project-nav";
import { useState } from "react";

export function ProjectDetail() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const project = useQuery(projectQuery(projectId));
  const [view, setView] = useState<"list" | "graph">("list");
  return <ProjectNav tab="jobs">{project.data && <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
    <div role="group" aria-label="Project jobs view" className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
      <Button className={`min-h-9 rounded-md border-0 px-3 py-1.5 ${view === "list" ? "bg-stone-100 text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white" : "bg-transparent text-slate-600 hover:bg-stone-50 dark:text-slate-300 dark:hover:bg-slate-800"}`} aria-pressed={view === "list"} onClick={() => setView("list")}>List</Button>
      <Button className={`min-h-9 rounded-md border-0 px-3 py-1.5 ${view === "graph" ? "bg-stone-100 text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white" : "bg-transparent text-slate-600 hover:bg-stone-50 dark:text-slate-300 dark:hover:bg-slate-800"}`} aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</Button>
    </div>
    <Link to="/jobs/new" search={{ projectId }}><Button variant="primary">Create job</Button></Link>
  </div>}{view === "list" ? <JobsTable projectId={projectId} /> : <ProjectGraph projectId={projectId} />}</ProjectNav>;
}
