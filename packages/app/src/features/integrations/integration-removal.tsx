import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { Button } from "../../shared/ui";
import { messageOf } from "../auth/session";

const previewPath = "/api/v1/integrations/removal/preview";
const confirmPath = "/api/v1/integrations/removal/confirm";
type PreviewOperation = paths[typeof previewPath]["post"];
type Target = PreviewOperation["requestBody"]["content"]["application/json"];
type Preview = PreviewOperation["responses"][200]["content"]["application/json"];
export type StartIntegrationRemoval = (target: Target & { name: string }) => void;
type Selection = Target & { name: string; attempt: string };

export function useIntegrationRemoval() {
  const cache = useQueryClient();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const preview = useQuery({
    queryKey: ["integration-removal", selection?.attempt],
    enabled: selection !== null,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!selection) throw new Error("No integration selected.");
      const { kind, id } = selection;
      const result = await api.POST(previewPath, { body: { kind, id }, signal });
      if (!result.data || result.error) throw new Error(messageOf(result.error));
      return result.data;
    },
  });
  const confirm = useMutation({
    retry: false,
    mutationFn: async ({ target, impact }: { target: Selection; impact: Preview }) => {
      const { kind, id } = target;
      const result = await api.POST(confirmPath, { body: {
        kind, id, fingerprint: impact.fingerprint, confirmImpact: impact.needsConfirmation,
      } });
      if (result.response.status === 409) return { changed: true };
      if (!result.data || result.error || !result.data.deleted) throw new Error(messageOf(result.error));
      return { changed: false };
    },
    onSuccess: async ({ changed }, { target }) => {
      if (changed) {
        setStale(true);
        setSelection({ ...target, attempt: crypto.randomUUID() });
        return;
      }
      setSelection(null);
      await Promise.all(["settings", "providers", "editor", "triggers", "events", "event-subscriptions", "vm-grants"]
        .map(key => cache.invalidateQueries({ queryKey: [key] })));
      setNotice(`${target.name} deleted.`);
    },
  });
  function open(target: Target & { name: string }) {
    if (selection || confirm.isPending) return;
    setNotice("");
    setStale(false);
    confirm.reset();
    setSelection({ ...target, attempt: crypto.randomUUID() });
  }
  const close = () => { if (!confirm.isPending) setSelection(null); };
  const impact = preview.isError || preview.isFetching ? undefined : preview.data;
  return {
    open,
    busy: selection !== null || confirm.isPending,
    notice: notice && <p role="status">{notice}</p>,
    dialog: selection && <Dialog title={`Delete ${selection.name}?`} close={close} busy={confirm.isPending}>
      {stale && <p role="alert" className="mb-3">The integration or its dependencies changed. Review the updated impact and confirm again.</p>}
      {preview.isFetching && <p role="status">Checking for dependencies…</p>}
      {preview.error && <p role="alert">{preview.error.message}</p>}
      {confirm.error && <p role="alert">{confirm.error.message}</p>}
      {impact && (impact.needsConfirmation ? <RemovalImpact impact={impact} /> :
        <p>This removes the connection from Factorize. It does not delete anything at the provider.</p>)}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={close} disabled={confirm.isPending}>Cancel</Button>
        {preview.isError && <Button type="button" onClick={() => { void preview.refetch(); }}>Check again</Button>}
        {impact && <Button type="button" variant="destructive" disabled={confirm.isPending}
          onClick={() => confirm.mutate({ target: selection, impact })}>
          {confirm.isPending ? "Deleting…" : impact.needsConfirmation ? "Delete and apply changes" : "Delete integration"}
        </Button>}
      </div>
    </Dialog>,
  };
}

function RemovalImpact({ impact }: { impact: Preview }) {
  const { sources, lookups, pausedEvents, clients, workloads } = impact;
  return <div className="space-y-3">
    <p>Deleting this integration removes the connection from Factorize and makes the changes below. Provider data, Events, and their history are not deleted.</p>
    {sources.length > 0 && <><h3 className="font-semibold">Trigger sources removed</h3><ul className="ml-5 list-disc">
      {sources.map(source => <li key={source.id}>
        {source.sourceName} in {source.triggerName} ({source.eventName}){source.deleteTrigger && " · Trigger removed if no sources remain"}
      </li>)}
    </ul></>}
    {lookups.length > 0 && <><h3 className="font-semibold">Event lookups removed</h3><ul className="ml-5 list-disc">
      {lookups.map(lookup => <li key={`${lookup.eventId}:${lookup.name}`}>
        {lookup.name} in {lookup.eventName}{lookup.cascaded && " · Depends on a removed lookup"}
      </li>)}
    </ul></>}
    {pausedEvents.length > 0 && <><h3 className="font-semibold">Events paused or left without active sources</h3><ul className="ml-5 list-disc">
      {pausedEvents.map(event => <li key={event.id}>{event.name}</li>)}
    </ul></>}
    {clients.length > 0 && <><h3 className="font-semibold">Clients losing this integration’s access</h3><ul className="ml-5 list-disc">
      {clients.map(client => <li key={client.id}>{client.name}</li>)}
    </ul></>}
    {workloads.length > 0 && <><h3 className="font-semibold">Workloads losing access</h3><ul className="ml-5 list-disc">
      {workloads.map(workload => <li key={workload.id}>{workload.name}{workload.revoked && " · Factorize grant revoked"}</li>)}
    </ul></>}
  </div>;
}
