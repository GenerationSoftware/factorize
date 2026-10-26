import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, ResourceHeader } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { InvokeJob } from "./invoke";
import { JobTabs } from "./tabs";
import type { Job } from "./editor-state";

type JobHeaderProps = {
  job: Pick<Job, "id" | "name" | "enabled" | "agentKind" | "model" | "runningCount" | "concurrencyLimit">;
};

export function JobHeader({ job }: JobHeaderProps) {
  const cache = useQueryClient();
  const enabled = useMutation({
    retry: false,
    mutationFn: async (value: boolean) => {
      const { error } = value
        ? await api.POST("/api/v1/jobs/{jobId}/enable", { params: { path: { jobId: job.id } } })
        : await api.POST("/api/v1/jobs/{jobId}/disable", { params: { path: { jobId: job.id } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["jobs"] });
      await cache.invalidateQueries({ queryKey: ["jobs", "detail", job.id] });
    },
  });

  return <>
    <ResourceHeader type="Job" title={job.name} description={<>{job.agentKind} · {job.model || "Default model"} · {job.runningCount}/{job.concurrencyLimit} running</>}><div className="flex max-w-full shrink-0 flex-wrap items-center gap-2"><InvokeJob jobId={job.id} enabled={job.enabled} />
      <Button className="min-h-9 px-2.5 py-1.5 text-xs" disabled={enabled.isPending} onClick={() => enabled.mutate(!job.enabled)}>{job.enabled ? "Disable job" : "Enable job"}</Button>
    </div></ResourceHeader>
    <JobTabs jobId={job.id} />
    {enabled.error && <p role="alert">{enabled.error.message}</p>}
  </>;
}
