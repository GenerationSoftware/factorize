import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import {
  Button, Card, Label, Page, PageHeader, Select, Table, Textarea,
  tableCellClasses, tableHeadClasses, tableRowClasses,
} from "../../shared/ui";
import { messageOf, sessionQuery } from "../auth/session";

type Grant = paths["/api/v1/vms"]["get"]["responses"][200]["content"]["application/json"][number];
const grantKey = ["vm-grants"];
const presetKey = ["settings", "permission-presets"];
const vmName = (grant: Grant) => grant.app ? `${grant.app}/${grant.vm}` : grant.vm;
const providerName = (grant: Grant) => grant.provider === "fly.io" ? "Fly.io" : grant.provider;
const linkClass = "font-semibold underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:decoration-current";

function useVmGrants() {
  const session = useQuery(sessionQuery);
  const capabilities = session.data?.authenticated ? session.data.capabilities : [];
  const canRead = capabilities.includes("vms:read");
  const grants = useQuery({
    queryKey: grantKey,
    enabled: canRead,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/vms", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  return { session, grants, canRead, canEdit: capabilities.includes("vms:edit") };
}

function GrantStatus({ session, grants, canRead }: ReturnType<typeof useVmGrants>) {
  if (session.error || grants.error) return <p role="alert">{(session.error ?? grants.error)?.message}</p>;
  if (session.isPending || (canRead && grants.isPending)) return <p role="status">Loading workloads…</p>;
  if (!canRead) return <p>You need VM read access to view these workloads.</p>;
  return null;
}

export function WorkloadsPage() {
  const state = useVmGrants();
  const rows = state.canRead ? state.grants.data : undefined;
  return <Page>
    <PageHeader title="Workloads" description="Workloads with access to Factorize." />
    <GrantStatus {...state} />
    {rows?.length === 0 && <p>No workloads have Factorize permissions.</p>}
    {!!rows?.length && <Table aria-label="Workloads">
      <thead className={tableHeadClasses}><tr>
        {["Workload", "Provider", "Permissions"].map(label => <th key={label} scope="col" className={tableCellClasses}>{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(grant => <tr key={grant.id} className={tableRowClasses}>
        <th scope="row" className={tableCellClasses}><Link className={linkClass} to="/workloads/$workloadId" params={{ workloadId: grant.id }}>{vmName(grant)}</Link></th>
        <td className={tableCellClasses}>{providerName(grant)}</td>
        <td className={tableCellClasses}>{grant.presetName ?? (grant.scopes.join(", ") || "No scopes")}</td>
      </tr>)}</tbody>
    </Table>}
  </Page>;
}

export function WorkloadPage() {
  const { workloadId } = useParams({ from: "/workloads/$workloadId" });
  const state = useVmGrants();
  const grant = state.canRead ? state.grants.data?.find(item => item.id === workloadId) : undefined;
  return <Page>
    <Link className={`mb-4 inline-block ${linkClass}`} to="/workloads">Back to Workloads</Link>
    <PageHeader title={grant ? vmName(grant) : "Workload"} description={grant && providerName(grant)} />
    <GrantStatus {...state} />
    {state.canRead && state.grants.isSuccess && !grant && <p>Workload not found.</p>}
    {grant && <Card>
      <h2>Permissions</h2>
      {grant.presetName && <p>{grant.presetName}</p>}
      <p className="break-words">{grant.scopes.join(", ") || "No scopes"}</p>
      {state.canEdit && <VmGrantActions key={grant.id} grant={grant} />}
    </Card>}
  </Page>;
}

function VmGrantActions({ grant }: { grant: Grant }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [editRevision, setEditRevision] = useState<number>();
  const [presetId, setPresetId] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [error, setError] = useState("");
  const presets = useQuery({
    queryKey: presetKey,
    enabled: editRevision !== undefined,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/permission-presets", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const refresh = () => cache.invalidateQueries({ queryKey: grantKey });
  const save = useMutation({
    mutationFn: async (expectedRevision: number) => {
      const scopes = [...new Set(scopeText.split(/\s+/).filter(Boolean))];
      const { error, response } = await api.POST("/api/v1/vms/grants", { body: {
        target: { kind: "existing", grantId: grant.id, expectedRevision },
        permissions: presetId ? { presetId } : { scopes },
      } });
      if (error) {
        if (response.status === 409 || response.status === 404) {
          setEditRevision(undefined);
          await refresh();
        }
        throw new Error(messageOf(error));
      }
    },
    onSuccess: async () => { setEditRevision(undefined); await refresh(); },
    onError: err => setError(err.message),
  });
  const revoke = useMutation({
    mutationFn: async (grant: Grant) => {
      const { error } = await api.DELETE("/api/v1/vms/grants/{grantId}", { params: { path: { grantId: grant.id } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: async () => {
      await refresh();
      await navigate({ to: "/workloads", replace: true });
    },
    onError: err => setError(err.message),
  });
  const busy = save.isPending || revoke.isPending;

  return <>
    {error && <p role="alert" className="mt-4">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button disabled={busy || editRevision !== undefined} onClick={() => { setError(""); setEditRevision(grant.revision); setPresetId(""); setScopeText(grant.scopes.join("\n")); }}>Edit permissions</Button>
      <Button variant="destructive" disabled={busy} onClick={() => {
        if (window.confirm(`Revoke Factorize permissions for ${vmName(grant)}? The VM will keep running.`)) {
          setError("");
          revoke.mutate(grant);
        }
      }}>Revoke permissions</Button>
    </div>
    {editRevision !== undefined && <div className="mt-5">
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setError(""); save.mutate(editRevision); }}>
        <h2>Edit permissions for {vmName(grant)}</h2>
        <Label>Permission source<Select value={presetId} onChange={event => setPresetId(event.target.value)}>
          <option value="">Explicit scopes</option>
          {presets.data?.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
        </Select></Label>
        {presets.error && <p role="alert">{presets.error.message}</p>}
        {!presetId && <Label>Permission scopes<Textarea value={scopeText} onChange={event => setScopeText(event.target.value)} /></Label>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => setEditRevision(undefined)}>Cancel</Button>
          <Button variant="primary" disabled={busy}>Save permissions</Button>
        </div>
      </form>
    </div>}
  </>;
}
