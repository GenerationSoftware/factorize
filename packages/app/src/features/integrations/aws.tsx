import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Button } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { IntegrationRow, ProviderTile } from "./integration-ui";

const regions = {
  "us-east-1": "US East (N. Virginia)", "us-west-2": "US West (Oregon)",
  "ap-southeast-1": "Asia Pacific (Singapore)", "ap-southeast-2": "Asia Pacific (Sydney)", "ap-northeast-1": "Asia Pacific (Tokyo)",
  "eu-central-1": "Europe (Frankfurt)", "eu-west-1": "Europe (Ireland)", "eu-west-2": "Europe (London)",
};
type Region = keyof typeof regions;
type Setup = paths["/api/v1/integrations/aws/{connectionId}/template"]["get"]["responses"][200]["content"]["application/json"];
const queryKey = ["settings", "aws"] as const;
const path = "/api/v1/integrations/aws";
const item = "/api/v1/integrations/aws/{connectionId}";
const byId = (connectionId: string) => ({ path: { connectionId } });
const field = "block w-full rounded-md border border-stone-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900";

function downloadTemplate(template: string) {
  const url = URL.createObjectURL(new Blob([template], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "factorize-aws-role.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function useAwsIntegration() {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false), [setup, setSetup] = useState<Setup | null>(null);
  const [name, setName] = useState(""), [region, setRegion] = useState<Region>("us-east-1");
  const [roleArn, setRoleArn] = useState(""), [installation, setInstallation] = useState("");
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const list = useQuery({ queryKey, queryFn: async ({ signal }) => {
    const response = await api.GET(path, { signal });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  } });
  const clients = useQuery({ queryKey: ["settings", "aws", "clients"], enabled: !!setup?.connection.roleArn, queryFn: async ({ signal }) => {
    const response = await api.GET("/api/v1/access/authorized-clients", { signal });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data.filter(client => !client.expiresAt || Date.parse(client.expiresAt) > Date.now());
  } });
  const fail = (reason: Error) => setError(reason.message);
  const clear = () => { setOpen(false); setSetup(null); setName(""); setRoleArn(""); setInstallation(""); setError(""); setNotice(""); };
  const refresh = () => cache.invalidateQueries({ queryKey });
  const prepare = useMutation({ retry: false, mutationFn: async () => {
    const response = await api.POST(path, { body: { name, region } });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  }, onSuccess: async newSetup => { setSetup(newSetup); await refresh(); }, onError: fail });
  const edit = useMutation({ retry: false, mutationFn: async (id: string) => {
    const response = await api.GET("/api/v1/integrations/aws/{connectionId}/template", { params: byId(id) });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  }, onSuccess: value => {
    setSetup(value); setRoleArn(value.connection.roleArn ?? ""); setInstallation(value.connection.oauthInstallationId ?? ""); setOpen(true);
  }, onError: fail });
  const verify = useMutation({ retry: false, mutationFn: async (id: string) => {
    const response = await api.POST("/api/v1/integrations/aws/{connectionId}/verify", { params: byId(id), body: { roleArn: roleArn.trim() } });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  }, onSuccess: async ({ connection }) => {
    setSetup(value => value && { ...value, connection });
    setNotice("AWS MCP Code Mode verified.");
    await refresh();
  }, onError: fail });
  const allow = useMutation({ retry: false, mutationFn: async (id: string) => {
    const response = await api.PUT("/api/v1/integrations/aws/{connectionId}/access", { params: byId(id), body: { oauthInstallationId: installation || null } });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
    return response.data;
  }, onSuccess: async connection => {
    setSetup(value => value && { ...value, connection });
    setNotice(connection.oauthInstallationId ? "Use access saved for the selected OAuth connection." : "Use access removed.");
    await refresh();
  }, onError: fail });
  const deleting = useMutation({ retry: false, mutationFn: async (id: string) => {
    const response = await api.DELETE(item, { params: byId(id) });
    if (!response.data || response.error) throw new Error(messageOf(response.error));
  }, onSuccess: async () => { setRemove(null); setNotice("AWS connection deleted in Factorize."); await refresh(); }, onError: fail });
  const busy = prepare.isPending || edit.isPending || verify.isPending || allow.isPending || deleting.isPending;
  const status = <>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</>;
  const connections = list.data?.connections ?? [];
  return {
    count: connections.length, pending: list.isPending,
    tile: <ProviderTile kind="aws" name="AWS" description="Run scripts through AWS-hosted MCP using a scoped IAM role." count={connections.length} onAdd={() => { clear(); setOpen(true); }} />,
    rows: connections.map(connection => <IntegrationRow key={connection.id} kind="aws" credentialId={connection.id} name="AWS" detail={connection.name + " · " + connection.region}
      status={!connection.roleArn ? "Setup incomplete" : connection.oauthInstallationId ? "Use access assigned" : "Owner only"}
      actions={[
        { label: connection.roleArn ? "Manage AWS connection" : "Finish AWS setup", disabled: busy, onClick: () => { clear(); edit.mutate(connection.id); } },
        { label: "Delete", destructive: true, disabled: busy, onClick: () => { clear(); setRemove(connection); } },
      ]} />),
    feedback: <>{list.isError && <p role="alert">{list.error.message}</p>}{!open && !remove && status}</>,
    dialog: <>
      {open && <Dialog title={setup ? "AWS connection · " + setup.connection.name : "Add AWS integration"} close={clear} busy={busy}>
        <div className="space-y-3">{status}
          {!list.data?.available ? <p>AWS workload signing isn’t configured on this Factorize deployment.</p> : !setup ?
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); setError(""); prepare.mutate(); }}>
              <label className="block">Connection name<input className={field} value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></label>
              <label className="block">AWS Region<select className={field} value={region} onChange={event => setRegion(event.target.value as Region)}>
                {Object.entries(regions).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
              </select></label>
              <Button type="submit" disabled={busy || !name.trim()}>Prepare AWS setup</Button>
            </form> : <>
              <p>Use a separate named connection for each AWS role. IAM controls which AWS actions the selected agent can perform.</p>
              <p>Connection ID: <code className="break-all">{setup.connection.id}</code></p>
              <p>Upload the template in AWS CloudFormation, then copy the <strong>RoleArn</strong> from its Outputs. If this AWS account already trusts this Factorize issuer, set <strong>CreateProvider</strong> to false.</p>
              <Button type="button" onClick={() => downloadTemplate(setup.template)}>Download CloudFormation template</Button>
              <form className="space-y-2" onSubmit={event => { event.preventDefault(); setError(""); setNotice(""); verify.mutate(setup.connection.id); }}>
                <label className="block">AWS role ARN<input className={field} value={roleArn} onChange={event => setRoleArn(event.target.value)} required readOnly={!!setup.connection.roleArn} /></label>
                <Button type="submit" disabled={busy || !roleArn.trim()}>{verify.isPending ? "Verifying AWS role…" : "Verify AWS role"}</Button>
              </form>
              {setup.connection.roleArn && <form className="space-y-2" onSubmit={event => { event.preventDefault(); setError(""); setNotice(""); allow.mutate(setup.connection.id); }}>
                <label className="block">Use access<select className={field} value={installation} onChange={event => setInstallation(event.target.value)}>
                  <option value="">No Use access</option>
                  {installation && !clients.data?.some(client => client.grantId === installation) && <option value={installation}>Currently selected (not available)</option>}
                  {clients.data?.map(client => <option key={client.grantId} value={client.grantId}>{client.clientName} · {client.grantId.slice(0, 8)}</option>)}
                </select></label>
                <p>Use access lets this exact OAuth connection run Code Mode for this AWS connection. It does not let the agent configure or grant access to integrations.</p>
                {clients.isError && <p role="alert">{clients.error.message}</p>}
                <Button type="submit" disabled={busy || (installation !== "" && !clients.data?.some(client => client.grantId === installation))}>Save Use access</Button>
              </form>}
            </>}
        </div>
      </Dialog>}
      {remove && <Dialog title={"Delete AWS connection · " + remove.name} close={() => setRemove(null)} busy={busy}>
        <div className="space-y-3">{status}<p>This removes access in Factorize. Remove the IAM role or its trust separately in AWS.</p>
          <Button type="button" disabled={busy} onClick={() => { setError(""); deleting.mutate(remove.id); }}>Delete AWS connection</Button>
        </div>
      </Dialog>}
    </>,
  };
}
