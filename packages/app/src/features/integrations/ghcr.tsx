import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, sessionQuery } from "../auth/session";
import { Button, Input, Label } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { SecretInput } from "../../shared/credential-fields";
import { IntegrationRow, ProviderTile } from "./integration-ui";
import type { StartIntegrationRemoval } from "./integration-removal";

type Record = { id: string; image: string; username: string; revision: number };
const path = "/api/v1/integrations/ghcr";
const title = "GitHub Container Registry";

export function useGhcrIntegrations(remove: StartIntegrationRemoval, removalBusy: boolean) {
  const cache = useQueryClient();
  const session = useQuery(sessionQuery);
  const owner = session.data?.authenticated && session.data.team?.role === "owner";
  const records = useQuery({ queryKey: ["settings", "ghcr"], enabled: !!owner, retry: false, queryFn: async () => {
    const result = await api.GET(path);
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return result.data;
  }});
  const [open,setOpen] = useState(false), [editing,setEditing] = useState<Record | null>(null);
  const [image,setImage] = useState(""), [username,setUsername] = useState(""), [token,setToken] = useState("");
  const [notice,setNotice] = useState("");
  const start = (record?: Record) => {
    setOpen(true); setEditing(record ?? null); setImage(record?.image ?? ""); setUsername(record?.username ?? ""); setToken(""); setNotice("");
  };
  const close = () => { setOpen(false); setToken(""); };
  const save = useMutation({ retry: false, mutationFn: async () => {
    const fields = { username: username.trim(), token };
    const result = editing ? await api.PUT("/api/v1/integrations/ghcr/{connectionId}", {
      params: { path: { connectionId: editing.id } }, body: { ...fields, expectedRevision: editing.revision },
    }) : await api.POST(path, { body: { ...fields, image: image.trim().toLowerCase() } });
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return result.data;
  }, onSuccess: async () => { close(); setNotice("GitHub Container Registry connection saved."); await cache.invalidateQueries({queryKey:["settings"]}); },
  onError: error => { setToken(""); setNotice(error.message); } });
  const list = Array.isArray(records.data) ? records.data : [];
  return {
    count: list.length, pending: !!owner && records.isPending,
    rows: list.map(record => <IntegrationRow key={record.id} kind="ghcr" credentialId={record.id} name={title} detail={record.image} actions={[
      { label: "Replace token", onClick: () => start(record) },
      { label: "Delete", destructive: true, disabled: removalBusy, onClick: () => remove({kind:"ghcr", id:record.id, name:record.image}) },
    ]} />),
    tile: owner && <ProviderTile kind="ghcr" name={title} description="Read tags and manifests for one public or private GHCR image." count={list.length} onAdd={() => start()} />,
    feedback: <>{records.error && <p role="alert">{records.error.message}</p>}{notice && !open && <p role="status">{notice}</p>}</>,
    dialog: owner && open && <Dialog title={editing ? "Replace GitHub Container Registry token" : "Add GitHub Container Registry integration"} close={close} busy={save.isPending}>
      <p className="text-sm">Use a classic GitHub personal access token with <code>read:packages</code>. Enable organization SSO for the token if required. This connection can inspect the image, but cannot download layers, push, or delete packages.</p>
      <form autoComplete="off" className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault();setNotice("");save.mutate(); }}>
        <Label>Image <Input required maxLength={255} placeholder="owner/image" disabled={!!editing} value={image} onChange={event => setImage(event.target.value)} /></Label>
        <Label>GitHub username <Input required maxLength={39} value={username} onChange={event => setUsername(event.target.value)} /></Label>
        <Label>Classic personal access token <SecretInput required name="ghcr-token" maxLength={255} value={token} onChange={event => setToken(event.target.value)} /></Label>
        {notice && <p role="alert">{notice}</p>}
        <div className="flex gap-2"><Button variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save connection"}</Button><Button type="button" disabled={save.isPending} onClick={close}>Cancel</Button></div>
      </form>
    </Dialog>,
  };
}
