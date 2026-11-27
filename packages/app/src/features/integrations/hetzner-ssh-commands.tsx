import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";

const key = ["settings", "hetzner", "ssh-command-targets"];
const path = "/api/v1/ssh/hetzner-targets/{serverId}";

export function HetznerSshCommands({ servers }: { servers: Array<{ id: number; name: string }> }) {
  const cache = useQueryClient();
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [notice, setNotice] = useState("");
  const pins = useQuery({ queryKey: key, retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/ssh/hetzner-targets", { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data.targets;
  } });
  const write = useMutation({ mutationFn: async ({ serverId, remove }: { serverId: string; remove?: true }) => {
    const params = { path: { serverId } };
    const { data, error } = remove ? await api.DELETE(path, { params }) :
      await api.PUT(path, { params, body: { username: username.trim(), hostFingerprint: fingerprint.trim() } });
    if (!data || error) throw new Error(messageOf(error));
  }, onSuccess: async (_, { remove }) => {
    setFingerprint("");
    setNotice(remove ? "SSH fingerprint removed." : "SSH fingerprint verified and saved.");
    await cache.invalidateQueries({ queryKey: key });
  } });

  if (servers.length === 0 && !pins.data?.length && !pins.error) return null;
  return <section className="mt-5 space-y-3" aria-label="Hetzner SSH commands">
    <h3 className="font-semibold">SSH commands</h3>
    <p>Choose an existing server. Verify its Ed25519 host fingerprint through a trusted console before saving it. The server must also have the client’s public key installed on the selected non-root account.</p>
    {notice && <p role="status">{notice}</p>}
    {(pins.error || write.error) && <p role="alert">{(pins.error ?? write.error)?.message}</p>}
    {pins.data?.map(pin => <div key={pin.serverId} className="flex flex-wrap items-center gap-2">
      <span>{servers.find(s => s.id === pin.serverId)?.name ?? "Server " + pin.serverId} (#{pin.serverId})</span>
      <span>{pin.needsVerification ? "Fingerprint changed. Verify again." : "Verified"}</span>
      <Button type="button" disabled={write.isPending} onClick={() => write.mutate({ serverId: String(pin.serverId), remove: true })}>Remove fingerprint</Button>
    </div>)}
    {servers.length > 0 && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); write.mutate({ serverId: server }); }}>
      <Label>Server for SSH commands
        <select className="block w-full rounded border p-2" required value={server} disabled={write.isPending} onChange={event => {
          const value = event.target.value;
          setServer(value);
          setUsername(pins.data?.find(pin => String(pin.serverId) === value)?.username ?? "");
          setFingerprint("");
          setNotice("");
          write.reset();
        }}>
          <option value="">Choose a server</option>
          {servers.map(s => <option key={s.id} value={s.id}>{s.name} (#{s.id})</option>)}
        </select>
      </Label>
      <Label>SSH username <Input value={username} required maxLength={32} onChange={event => setUsername(event.target.value)} /></Label>
      <Label>Verified SSH host fingerprint <Input value={fingerprint} required maxLength={50} placeholder="SHA256:…" onChange={event => setFingerprint(event.target.value)} /></Label>
      <Button variant="primary" disabled={write.isPending || !server || !username.trim() || !fingerprint.trim()}>Save verified fingerprint</Button>
    </form>}
  </section>;
}
