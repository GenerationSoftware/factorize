import { Page } from "../../shared/ui";
import { JobActions } from "./header";
import { RunHistory } from "../runs/history";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobQuery } from "./queries";
import { JobNav } from "./job-nav";
export function JobDetail() {
  const { jobId } = useParams({ strict: false });
  const query = useQuery(jobQuery(jobId!));
  const job = query.data;
  return <>{job?.projectId && <JobNav jobId={job.id} tab="runs" />}<Page className="pt-6 sm:pt-8">
    {query.isPending && <p role="status">Loading job…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><JobActions job={job} /><div className="mb-6"><RunHistory jobId={job.id} /></div></>}
  </Page></>;
}
