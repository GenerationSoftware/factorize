import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Button, Card, Label, Page, PageHeader, Select, Textarea } from "../../shared/ui";
import { messageOf, sessionQuery } from "../auth/session";

type Grant = paths["/api/v1/vms"]["get"]["responses"][200]["content"]["application/json"][number];
const grantKey = ["vm-grants"];
const presetKey = ["settings", "permission-presets"];
const vmName = (grant: Grant) => grant.app ? `${grant.app}/${grant.vm}` : grant.vm;

export function VmsPage() {
  const cache = useQueryClient();
  const session = useQuery(sessionQuery);
  const capabilities = session.data?.authenticated ? session.data.capabilities : [];
  const canRead = capabilities.includes("vms:read");
  const canEdit = capabilities.includes("vms:edit");
  const [editing, setEditing] = useState<Grant | null>(null);
  const [presetId, setPresetId] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [error, setError] = useState("");
  const grants = useQuery({
    queryKey: grantKey,
    enabled: canRead,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/vms", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const presets = useQuery({
    queryKey: presetKey,
    enabled: Boolean(editing) && canEdit,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/permission-presets", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const refresh = () => cache.invalidateQueries({ queryKey: grantKey });
  const save = useMutation({
    mutationFn: async (grant: Grant) => {
      const scopes = [...new Set(scopeText.split(/\s+/).filter(Boolean))];
      const { error, response } = await api.POST("/api/v1/vms/grants", { body: {
        target: { kind: "existing", grantId: grant.id, expectedRevision: grant.revision },
        permissions: presetId ? { presetId } : { scopes },
      } });
      if (error) {
        if (response.status === 409 || response.status === 404) {
          setEditing(null);
          await refresh();
        }
        throw new Error(messageOf(error));
      }
    },
    onSuccess: async () => { setEditing(null); await refresh(); },
    onError: err => setError(err.message),
  });
  const revoke = useMutation({
    mutationFn: async (grant: Grant) => {
      const { error } = await api.DELETE("/api/v1/vms/grants/{grantId}", { params: { path: { grantId: grant.id } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: async (_, grant) => {
      if (editing?.id === grant.id) setEditing(null);
      await refresh();
    },
    onError: err => setError(err.message),
  });
  const busy = save.isPending || revoke.isPending;

  return <Page>
    <PageHeader title="VMs" description="Factorize permissions granted to team virtual machines." />
    {(error || grants.error) && <p role="alert" className="mb-4">{error || grants.error?.message}</p>}
    {session.isPending || (canRead && grants.isPending) ? <p role="status">Loading VMs…</p>
      : !canRead ? <p>You need VM read access to view grants.</p>
      : grants.data?.length === 0 ? <p>No VMs have Factorize permissions.</p>
      : grants.data && <ul aria-label="VM grants" className="grid gap-3">{grants.data.map(grant => <li key={grant.id}>
        <Card className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg break-all">{vmName(grant)}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{grant.provider}{grant.presetName && ` · ${grant.presetName}`}</p>
            <p className="mt-2 text-sm break-all">{grant.scopes.join(", ") || "No scopes"}</p>
          </div>
          {canEdit && <div className="flex shrink-0 flex-wrap gap-2">
            <Button disabled={busy} onClick={() => { setError(""); setEditing(grant); setPresetId(""); setScopeText(grant.scopes.join("\n")); }}>Edit permissions</Button>
            <Button disabled={busy} onClick={() => {
              if (window.confirm(`Revoke Factorize permissions for ${vmName(grant)}? The VM will keep running.`)) {
                setError("");
                revoke.mutate(grant);
              }
            }}>Revoke permissions</Button>
          </div>}
        </Card>
      </li>)}</ul>}
    {editing && canEdit && <Card className="mt-5">
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setError(""); save.mutate(editing); }}>
        <h2>Edit permissions for {vmName(editing)}</h2>
        <Label>Permission source<Select value={presetId} onChange={event => setPresetId(event.target.value)}>
          <option value="">Explicit scopes</option>
          {presets.data?.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
        </Select></Label>
        {presets.error && <p role="alert">{presets.error.message}</p>}
        {!presetId && <Label>Permission scopes<Textarea value={scopeText} onChange={event => setScopeText(event.target.value)} /></Label>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy}>Save permissions</Button>
        </div>
      </form>
    </Card>}
  </Page>;
}
