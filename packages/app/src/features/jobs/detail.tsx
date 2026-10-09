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
  return <main className="mx-auto max-w-4xl p-6"><Link to="/jobs" search={{ q: "" }}>Jobs</Link>
    {query.isPending && <p role="status">Loading job…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {job && <><h1 className="text-3xl font-semibold">{job.name}</h1><p>{job.agentKind} · {job.model || "Default model"} · {job.runningCount}/{job.concurrencyLimit} running</p>
      <button disabled={enabled.isPending} onClick={() => enabled.mutate(!job.enabled)}>{job.enabled ? "Disable job" : "Enable job"}</button>
      {enabled.error && <p role="alert">{enabled.error.message}</p>}
      <details><summary>Prompt template</summary><pre className="whitespace-pre-wrap break-words">{job.promptTemplate}</pre></details>
      <InvokeJob jobId={job.id} enabled={job.enabled} />
    </>}
  </main>;
}
