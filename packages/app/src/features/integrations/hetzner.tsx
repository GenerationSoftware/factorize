import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { SecretInput } from "../../shared/credential-fields";
import { Button, Input, Label, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { messageOf, sessionQuery } from "../auth/session";
import { IntegrationRow, ProviderTile } from "./integration-ui";
import { HetznerSsh } from "./hetzner-ssh";

const connectionPath = "/api/v1/hetzner/connection";
const serversPath = "/api/v1/hetzner/servers";
const connectionKey = ["settings", "hetzner", "connection"];
const inventoryKey = ["settings", "hetzner", "servers"];

export function useHetznerIntegration() {
  const cache = useQueryClient();
  const session = useQuery(sessionQuery);
  const owner = session.data?.authenticated && session.data.team?.role === "owner";
  const [screen, setScreen] = useState<"edit" | "delete" | "inventory" | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: connectionKey, enabled: Boolean(owner), retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(connectionPath, { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data.connection;
  } });
  const connection = query.data;
  const inventory = useQuery({ queryKey: inventoryKey, enabled: Boolean(owner && connection && screen === "inventory"), retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(serversPath, { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  } });
  const write = useMutation({ retry: false, mutationFn: async (operation: "save" | "delete") => {
    const result = operation === "save" ? await api.PUT(connectionPath, { body: { name: name.trim(), token: token.trim() } }) :
      await api.DELETE(connectionPath);
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return operation;
  }, onSuccess: async operation => {
    setNotice(operation === "save" ? "Hetzner Cloud project saved." : "Hetzner Cloud connection deleted.");
    setScreen(null);
    cache.removeQueries({ queryKey: inventoryKey });
    await cache.invalidateQueries({ queryKey: ["settings", "hetzner"] });
  }, onSettled: () => setToken("") });
  function open(next: typeof screen) {
    setName(connection?.name ?? "");
    setToken("");
    setNotice("");
    write.reset();
    setScreen(next);
  }
  function close() { if (!write.isPending) open(null); }
  const error = write.error && <p role="alert">{write.error.message}</p>;
  return {
    count: owner && connection ? 1 : 0,
    pending: Boolean(owner && query.isPending),
    rows: owner && connection ? <IntegrationRow kind="hetzner" credentialId="hetzner" name="Hetzner Cloud" detail={connection.name} ownerOnly actions={[
      { label: "View servers", onClick: () => open("inventory") },
      { label: "Replace connection", onClick: () => open("edit") },
      { label: "Delete", destructive: true, onClick: () => open("delete") },
    ]} /> : null,
    tile: owner && <ProviderTile kind="hetzner" name="Hetzner Cloud" description="Read server inventory for one project. Owner only." count={connection ? 1 : 0}
      onAdd={() => open("edit")} />,
    feedback: owner && <>{query.error && <p role="alert">{query.error.message}</p>}{notice && <p role="status">{notice}</p>}</>,
    dialog: owner && <>
      {screen === "edit" && <Dialog title={connection ? "Replace Hetzner Cloud connection" : "Add Hetzner Cloud integration"} close={close} busy={write.isPending}>
        <form autoComplete="off" method="post" className="grid gap-3" onSubmit={event => { event.preventDefault(); write.mutate("save"); }}>
          <Label>Project name <Input value={name} maxLength={120} required disabled={write.isPending} onChange={event => setName(event.target.value)} /></Label>
          <Label>Read-only project API token <SecretInput name="hetzner-project-token" value={token} maxLength={256} required disabled={write.isPending} onChange={event => setToken(event.target.value)} /></Label>
          <p className="text-sm">Create a project API token with Read permission in Hetzner Cloud Console. Factorize checks that it can list servers; it cannot verify the token’s permission setting.</p>
          {connection && <p className="text-sm">Replacing the connection also removes any saved SSH keys for this project from Factorize.</p>}
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={write.isPending || !name.trim() || !token.trim()}>{write.isPending ? "Saving…" : "Save connection"}</Button>
          <Button type="button" onClick={close} disabled={write.isPending}>Cancel</Button></div>
        </form>{error}
      </Dialog>}
      {screen === "delete" && <Dialog title="Delete Hetzner Cloud connection?" close={close} busy={write.isPending}>
        <p>This removes the saved connection and its saved SSH keys from Factorize. It does not delete or change anything at Hetzner.</p>
        <div className="mt-5 flex gap-2"><Button type="button" onClick={close} disabled={write.isPending}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={write.isPending} onClick={() => write.mutate("delete")}>{write.isPending ? "Deleting…" : "Delete connection"}</Button></div>
        {error}
      </Dialog>}
      {screen === "inventory" && <Dialog title="Hetzner Cloud servers" close={close}>
        {inventory.isPending && <p role="status">Loading servers…</p>}
        {inventory.error && <p role="alert">{inventory.error.message}</p>}
        {inventory.data && <>{inventory.data.servers.length === 0 ? <p>No servers in this project.</p> :
          <Table aria-label="Hetzner Cloud servers"><thead className={tableHeadClasses}><tr>
            {["Server", "Status", "Location"].map(title => <th key={title} scope="col" className={tableCellClasses}>{title}</th>)}
          </tr></thead><tbody>{inventory.data.servers.map(server => <tr className={tableRowClasses} key={server.id}>
            <th scope="row" className={tableCellClasses}>{server.name}</th><td className={tableCellClasses}>{server.status}</td><td className={tableCellClasses}>{server.location ?? "Not available"}</td>
          </tr>)}</tbody></Table>}
          {inventory.data.truncated && <p role="status">Showing the first 100 servers.</p>}
        </>}
        <Button type="button" onClick={() => void inventory.refetch()} disabled={inventory.isFetching}>Refresh servers</Button>
        {inventory.data && <HetznerSsh servers={inventory.data.servers} />}
      </Dialog>}
    </>,
  };
}
