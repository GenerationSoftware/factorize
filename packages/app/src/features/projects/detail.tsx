import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Page, PageHeader } from "../../shared/ui";
import { projectQuery } from "./queries";
import { JobsTable } from "../jobs/list";
export function ProjectDetail() { const { projectId } = useParams({ from: "/projects/$projectId" }); const project=useQuery(projectQuery(projectId)); return <Page className="max-w-6xl"><Link to="/projects" className="text-sm font-semibold">Projects</Link>{project.data&&<><PageHeader title={project.data.name} description={project.data.description}><Link to="/jobs/new" search={{ projectId }}><Button>Create job</Button></Link></PageHeader><JobsTable projectId={projectId} /></>}</Page>; }
