import { Page } from "../../shared/ui";
import { JobHeader } from "./header";
import { RunHistory } from "../runs/history";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobQuery } from "./queries";
export function JobDetail() {
  const { jobId } = useParams({ strict: false });
  const query = useQuery(jobQuery(jobId!));
  const job = query.data;
  return <Page className="max-w-6xl"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>
    {query.isPending && <p role="status">Loading job…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><JobHeader job={job} /><div className="mb-6">
      <RunHistory jobId={job.id} />
      </div>
    </>}
  </Page>;
}
