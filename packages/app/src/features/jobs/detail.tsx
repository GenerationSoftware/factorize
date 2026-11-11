import { Breadcrumb, Page, ResourceHeader } from "../../shared/ui";
import { JobHeader } from "./header";
import { RunHistory } from "../runs/history";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobQuery } from "./queries";
import { projectQuery } from "../projects/queries";
import { ProjectNav } from "../projects/project-nav";
export function JobDetail() {
  const { jobId } = useParams({ strict: false });
  const query = useQuery(jobQuery(jobId!));
  const job = query.data;
  const project = useQuery({ ...projectQuery(job?.projectId ?? ""), enabled: !!job?.projectId });
  const content = <>
    {query.isPending && <><ResourceHeader type="Job" title="Job" /><p role="status">Loading job…</p></>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><JobHeader job={job} /><div className="mb-6"><RunHistory jobId={job.id} /></div></>}
  </>;
  return job?.projectId
    ? <ProjectNav tab="jobs" projectId={job.projectId}>{content}</ProjectNav>
    : <Page className="max-w-6xl"><Breadcrumb><Link to="/projects">Projects</Link></Breadcrumb>{content}</Page>;
}
