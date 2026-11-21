import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { messageOf } from "../auth/session";
import { Page } from "../../shared/ui";

type VmAttachment = paths["/api/v1/vms"]["get"]["responses"][200]["content"]["application/json"][number];
type Source = { kind: "run" | "client"; id: string };

async function loadAttachments(source?: Source) {
  const response = source?.kind === "run"
    ? await api.GET("/api/v1/runs/{runId}/vms", { params: { path: { runId: source.id } } })
    : source?.kind === "client"
      ? await api.GET("/api/v1/access/authorizations/{grantId}/vms", { params: { path: { grantId: source.id } } })
      : await api.GET("/api/v1/vms");
  if (response.error) throw new Error(messageOf(response.error));
  return response.data ?? [];
}

function AttachmentSource({ attachment }: { attachment: VmAttachment }) {
  if (attachment.source === "run") return <Link className="underline" to="/runs/$runId/vms" params={{runId: attachment.sourceId}} search={{after: 0}}>{attachment.sourceName ?? `Run ${attachment.sourceId.slice(0, 8)}`}</Link>;
  return <Link className="underline" to="/clients/$grantId" params={{grantId: attachment.sourceId}}>{attachment.sourceName ?? `MCP connection ${attachment.sourceId.slice(0, 8)}`}</Link>;
}

export function VmAttachments({ source }: { source?: Source }) {
  const query = useQuery({
    queryKey: ["vm-attachments", source?.kind, source?.id],
    queryFn: () => loadAttachments(source),
    refetchInterval: 15_000,
  });
  if (query.isPending) return <p role="status">Loading VMs…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  if (!query.data.length) return <p>{source ? "No VM attachments recorded." : "No VMs currently have Factorize proxy access."}</p>;
  return <div className="overflow-x-auto"><table aria-label="VM attachments" className="w-full text-left text-sm">
    <thead><tr>
      <th className="px-2 py-3">VM</th>
      <th className="px-2 py-3">Provider</th>
      {!source && <th className="px-2 py-3">Attached to</th>}
      <th className="px-2 py-3">Access status</th>
      <th className="px-2 py-3">Expires</th>
    </tr></thead>
    <tbody>{query.data.map(attachment => <tr key={`${attachment.source}:${attachment.id}`} className="border-t border-stone-200 dark:border-slate-800">
      <th scope="row" className="px-2 py-3 font-medium">{attachment.app ? `${attachment.app}/${attachment.vmId}` : attachment.vmId}</th>
      <td className="px-2 py-3">{attachment.provider}</td>
      {!source && <td className="px-2 py-3"><AttachmentSource attachment={attachment} /></td>}
      <td className="px-2 py-3 capitalize">{attachment.status}</td>
      <td className="px-2 py-3">{new Date(attachment.expiresAt).toLocaleString()}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function VmsPage() {
  return <Page><h1 className="mb-4">VMs</h1><VmAttachments /></Page>;
}
