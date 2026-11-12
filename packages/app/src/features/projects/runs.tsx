import { useParams } from "@tanstack/react-router";
import { RunList } from "../runs/list";
import { ProjectNav } from "./project-nav";
export function ProjectRuns() { const { projectId } = useParams({ from: "/projects/$projectId/runs" }); return <ProjectNav tab="jobs"><h2 className="sr-only">Project runs</h2><RunList projectId={projectId} limit={20} /></ProjectNav>; }
