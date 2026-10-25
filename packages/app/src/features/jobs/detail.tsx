import { Page } from "../../shared/ui";
import { JobHeader } from "./header";
import { RunHistory } from "../runs/history";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobQuery } from "./queries";
import { projectQuery } from "../projects/queries";
export function JobDetail() {
  const { jobId } = useParams({ strict: false });
  const query = useQuery(jobQuery(jobId!));
  const job = query.data;
  const project = useQuery({ ...projectQuery(job?.projectId ?? ""), enabled: !!job?.projectId });
  return <Page className="max-w-6xl"><nav aria-label="Breadcrumb"><Link to="/projects" className="font-semibold">Projects</Link><span aria-hidden="true">→</span>{project.data && job?.projectId ? <Link to="/projects/$projectId" params={{ projectId: job.projectId }}>{project.data.name}</Link> : null}</nav>
    {query.isPending && <p role="status">Loading job…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><JobHeader job={job} /><div className="mb-6"><RunHistory jobId={job.id} /></div></>}
  </Page>;
}
