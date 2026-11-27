import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { clientsQuery } from "../access-control/queries";
import { messageOf } from "../auth/session";

const path = "/api/v1/hetzner/ssh";
const key = ["settings", "hetzner", "ssh"];

export function HetznerSsh({ servers }: { servers: Array<{ id: number; name: string }> }) {
  const cache = useQueryClient();
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [client, setClient] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const enrolled = useQuery({ queryKey: key, retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(path, { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data.servers;
  } });
  const clients = useQuery(clientsQuery);
  const install = useMutation({ mutationFn: async () => {
    const { data, error } = await api.POST(path, { body: {
      serverId: Number(server), username: username.trim(), hostFingerprint: fingerprint.trim(), clientInstallationId: client,
    } });
    if (!data || error) throw new Error(messageOf(error));
  }, onSuccess: async () => {
    setServer(""); setUsername(""); setFingerprint(""); setClient("");
    setNotice("Enrollment saved. Install its public key before checking SSH.");
    await cache.invalidateQueries({ queryKey: key });
  } });
  const action = useMutation({ mutationFn: async ({ id, remove }: { id: number; remove: boolean }) => {
    const params = { path: { serverId: String(id) } };
    if (remove) {
      const { data, error } = await api.DELETE("/api/v1/hetzner/ssh/{serverId}", { params });
      if (!data || error) throw new Error(messageOf(error));
    } else {
      const { data, error } = await api.POST("/api/v1/hetzner/ssh/{serverId}/check", { params });
      if (!data || error) throw new Error(messageOf(error));
      return data.authenticated;
    }
  }, onSuccess: async (_, { remove }) => {
    setConfirm(null);
    setNotice(remove ? "SSH enrollment deleted." : "SSH authentication passed. The connection is closed.");
    if (remove) await cache.invalidateQueries({ queryKey: key });
  } });
  const pending = install.isPending || action.isPending;
  const available = servers.filter(s => !enrolled.data?.some(e => e.serverId === s.id));
  return <section className="mt-5 space-y-4" aria-label="Hetzner SSH">
    <h3 className="font-semibold">SSH health checks</h3>
    <p>Choose one MCP client and a dedicated non-root server account. Get the server’s Ed25519 fingerprint from its trusted console. Factorize never shows the private key.</p>
    {notice && <p role="status">{notice}</p>}
    {[enrolled.error, clients.error, install.error, action.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
    {enrolled.data?.map(item => <div key={item.serverId} className="space-y-2">
      <h4 className="font-semibold">{servers.find(s => s.id === item.serverId)?.name ?? `Server ${item.serverId}`}</h4>
      <Label>Authorized keys entry for {item.username}<Input readOnly value={`restrict,command="/bin/true" ${item.publicKey}`} onFocus={event => event.target.select()} /></Label>
      <p className="text-sm">Install the complete line for that account. It limits the key to the health check and disables forwarding and interactive access.</p>
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={() => action.mutate({ id: item.serverId, remove: false })}>Check SSH</Button>
        {confirm === item.serverId
          ? <><Button type="button" variant="destructive" disabled={pending} onClick={() => action.mutate({ id: item.serverId, remove: true })}>Confirm delete SSH enrollment</Button>
            <Button type="button" onClick={() => setConfirm(null)}>Cancel</Button></>
          : <Button type="button" disabled={pending} onClick={() => setConfirm(item.serverId)}>Delete SSH enrollment</Button>}
      </div>
      {confirm === item.serverId && <p className="text-sm">This removes Factorize’s key. Remove the public key from the server separately.</p>}
    </div>)}
    {available.length > 0 && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); install.mutate(); }}>
      <Label>Server<select value={server} onChange={event => setServer(event.target.value)} required disabled={pending}>
        <option value="">Select a server</option>{available.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></Label>
      <Label>SSH user<Input value={username} required maxLength={32} onChange={event => setUsername(event.target.value)} disabled={pending} /></Label>
      <Label>Ed25519 host fingerprint<Input value={fingerprint} placeholder="SHA256:…" required onChange={event => setFingerprint(event.target.value)} disabled={pending} /></Label>
      <Label>Authorized MCP client<select value={client} onChange={event => setClient(event.target.value)} required disabled={pending}>
        <option value="">Select a client</option>{clients.data?.filter(c => c.credentialScopes.includes("integrations:read")).map(c => <option key={c.grantId} value={c.grantId}>{c.clientName}</option>)}
      </select></Label>
      <Button type="submit" variant="primary" disabled={pending || !server || !username || !fingerprint || !client}>Generate SSH key</Button>
    </form>}
  </section>;
}
