import { Badge, Button, Page } from "../../shared/ui";
import { JobTabs } from "./tabs";
import { RunHistory } from "../runs/history";
import { useParams, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { jobQuery } from "./queries";
import { InvokeJob } from "./invoke";
import { messageOf } from "../auth/session";
export function JobDetail() {
  const { jobId } = useParams({ strict: false });
  const cache = useQueryClient(), query = useQuery(jobQuery(jobId!));
  const enabled = useMutation({ retry: false, mutationFn: async (value: boolean) => {
    const { error } = value ? await api.POST("/api/v1/jobs/{jobId}/enable", { params: { path: { jobId: jobId! } } }) : await api.POST("/api/v1/jobs/{jobId}/disable", { params: { path: { jobId: jobId! } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["jobs"] }) });
  const job = query.data;
  return <Page className="max-w-6xl"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>
    {query.isPending && <p role="status">Loading job…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><h1 className="mt-5 break-words text-3xl font-semibold">{job.name}</h1><JobTabs jobId={job.id} /><div className="mb-6 flex flex-wrap items-center gap-3"><Badge active={job.enabled}>{job.enabled ? "Enabled" : "Disabled"}</Badge><p className="text-sm text-slate-600 dark:text-slate-400">{job.agentKind} · {job.model || "Default model"} · {job.runningCount}/{job.concurrencyLimit} running</p></div><div className="mb-6 flex flex-wrap items-center gap-3"><InvokeJob jobId={job.id} enabled={job.enabled} />
      <Button disabled={enabled.isPending} onClick={() => enabled.mutate(!job.enabled)}>{job.enabled ? "Disable job" : "Enable job"}</Button>
      </div>{enabled.error && <p role="alert">{enabled.error.message}</p>}
      <RunHistory jobId={job.id} />
    </>}
  </Page>;
}
