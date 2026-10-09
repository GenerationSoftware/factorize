import { Disclosure, Summary, Badge, Button, Page, Card } from "../../shared/ui";
import { DeleteJob } from "./delete";
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
    {job && <><h1 className="mt-5 text-3xl font-semibold">{job.name}</h1><div className="mb-6 flex flex-wrap items-center gap-3"><Badge active={job.enabled}>{job.enabled ? "Enabled" : "Disabled"}</Badge><p className="text-sm text-slate-600 dark:text-slate-400">{job.agentKind} · {job.model || "Default model"} · {job.runningCount}/{job.concurrencyLimit} running</p></div><div className="mb-6 flex flex-wrap items-center gap-3"><InvokeJob jobId={job.id} enabled={job.enabled} />
      <Link to="/jobs/$jobId/edit" params={{ jobId: job.id }} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Edit job</Link>
      <Button disabled={enabled.isPending} onClick={() => enabled.mutate(!job.enabled)}>{job.enabled ? "Disable job" : "Enable job"}</Button>
      </div>{enabled.error && <p role="alert">{enabled.error.message}</p>}
      <Disclosure><Summary>Prompt template</Summary><pre className="whitespace-pre-wrap break-words">{job.promptTemplate}</pre></Disclosure>
      <Card><h2>Triggers</h2><ul>{job.triggers.map(trigger => <li key={trigger.id}>{trigger.slug} · {trigger.kind} · {trigger.enabled ? "Enabled" : "Disabled"}{trigger.kind === "webhook" && <span> · {trigger.config.conditions ? "Conditions configured" : "No additional conditions"}</span>}{trigger.kind === "webhook" && trigger.config.provider === "cloudflareTail" && trigger.config.destination && <><p>Tail webhook destination</p><code className="break-all">{trigger.config.destination}</code></>}</li>)}</ul></Card>
      <RunHistory jobId={job.id} /><DeleteJob jobId={job.id} name={job.name} />
    </>}
  </Page>;
}
