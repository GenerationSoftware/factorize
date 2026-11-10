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
  return <ProjectNav tab="jobs" actions={project.data&&<div className="flex flex-wrap items-center gap-3"><div role="group" aria-label="Project jobs view" className="flex gap-2"><Button aria-pressed={view === "list"} onClick={() => setView("list")}>List</Button><Button aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</Button></div><Link to="/jobs/new" search={{ projectId }}><Button variant="primary">Create job</Button></Link></div>}>{view === "list" ? <JobsTable projectId={projectId} /> : <ProjectGraph projectId={projectId} />}</ProjectNav>;
}
