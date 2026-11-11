import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label } from "../../shared/ui";
import { encryptRecord, verifyUnlockKey } from "../../lib/unlock-crypto";
import { getUnlockVerification } from "../../lib/unlock-key";
import { messageOf } from "../auth/session";

type BearerRecord = { id: string; name: string; origin: string; description: string | null; revision: number; encryptedPayload: string };
const recordsQuery = { queryKey: ["settings", "bearer-integrations"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/integrations/bearer", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data;
} };
const verificationQuery = { queryKey: ["unlock-key-verification"], queryFn: ({ signal }: { signal: AbortSignal }) => getUnlockVerification(signal), retry: false as const };
const bytesToBase64 = (bytes: Uint8Array) => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
const base64UrlToBytes = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));

function validOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0") return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some(part => part > 255) || octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
          (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)) return false;
    }
    return true;
  } catch { return false; }
}

export function BearerIntegrations() {
  const cache = useQueryClient(), records = useQuery(recordsQuery), verification = useQuery(verificationQuery);
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(""), [origin, setOrigin] = useState(""), [description, setDescription] = useState(""), [token, setToken] = useState(""), [key, setKey] = useState("");
  const [notice, setNotice] = useState("");
  const clearFields = () => { setToken(""); setKey(""); };
  const save = useMutation({ retry: false, mutationFn: async () => {
    const cleanName = name.trim(), cleanOrigin = origin.trim(), cleanDescription = description.trim();
    if (!cleanName || cleanName.length > 120) throw new Error("Enter a name up to 120 characters.");
    if (!validOrigin(cleanOrigin)) throw new Error("Enter a public HTTPS origin without a path, query, fragment, or credentials.");
    if (cleanDescription.length > 500) throw new Error("Description must be at most 500 characters.");
    if (!token) throw new Error("Enter a bearer token to create or replace this credential.");
    const setup = verification.data?.verification;
    if (!setup || !verification.data) throw new Error("Set up an unlock key before managing bearer integrations.");
    try { await verifyUnlockKey(key, verification.data.ownerId, setup.generationId, JSON.parse(setup.encryptedVerification)); }
    catch (error) {
      if (error instanceof TypeError && error.message === "Malformed unlock key") throw error;
      throw new Error("Unlock key could not be verified for this account and generation.");
    }
    const id = editing ?? crypto.randomUUID(), expectedRevision = records.data?.revision ?? 0;
    const encrypted = await encryptRecord(new TextEncoder().encode(token), key, { ownerId: verification.data.ownerId, recordId: id, recordType: "bearer", destination: cleanOrigin, revision: expectedRevision + 1 });
    const encryptedPayload = `${bytesToBase64(base64UrlToBytes(encrypted.nonce))}.${bytesToBase64(base64UrlToBytes(encrypted.ciphertext))}`;
    const body = { expectedRevision, idempotencyKey: crypto.randomUUID(), name: cleanName, origin: cleanOrigin, description: cleanDescription || null, encryptedPayload };
    if (editing) {
      const { data, error } = await api.PUT("/api/v1/integrations/bearer/{integrationId}", { params: { path: { integrationId: editing } }, body });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    }
    const { data, error } = await api.POST("/api/v1/integrations/bearer", { body: { ...body, id } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }, onSuccess: async () => { clearFields(); setNotice("Saved encrypted integration. Changes remain pending until the proxy is unlocked."); setEditing(null); setName(""); setOrigin(""); setDescription(""); await cache.invalidateQueries({ queryKey: recordsQuery.queryKey }); }, onError: async error => { clearFields(); setNotice(error.message); if (error.message.includes("changed") || error.message.includes("revision")) await cache.invalidateQueries({ queryKey: recordsQuery.queryKey }); } });
  const remove = useMutation({ retry: false, mutationFn: async (record: BearerRecord) => {
    const { data, error } = await api.DELETE("/api/v1/integrations/bearer/{integrationId}", { params: { path: { integrationId: record.id } }, body: { expectedRevision: records.data?.revision ?? 0, idempotencyKey: crypto.randomUUID() } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }, onSuccess: async () => { setNotice("Integration deleted."); await cache.invalidateQueries({ queryKey: recordsQuery.queryKey }); }, onError: async error => { setNotice(error.message); await cache.invalidateQueries({ queryKey: recordsQuery.queryKey }); } });
  const beginEdit = (record: BearerRecord) => { clearFields(); setNotice(""); setEditing(record.id); setName(record.name); setOrigin(record.origin); setDescription(record.description ?? ""); };
  const reset = () => { clearFields(); setEditing(null); setName(""); setOrigin(""); setDescription(""); setNotice(""); };
  return <section className="mt-10 space-y-4" aria-labelledby="bearer-integrations-heading">
    <div><h2 id="bearer-integrations-heading" className="text-2xl font-bold">Bearer integrations</h2><p className="text-sm text-slate-600 dark:text-slate-400">Credentials are encrypted in this browser. Stored tokens cannot be viewed; edit to replace one.</p></div>
    {records.isPending && <p role="status">Loading bearer integrations…</p>}{records.error && <p role="alert">{records.error.message}</p>}
    {records.data?.integrations.map(record => <Card key={record.id} className="flex flex-wrap items-center gap-3"><div className="min-w-40 flex-1"><p className="font-semibold">{record.name}</p><p>{record.origin}</p>{record.description && <p>{record.description}</p>}<p className="text-sm">Bearer token stored encrypted</p></div><Button type="button" onClick={() => beginEdit(record)}>Replace or edit</Button><Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${record.name}?`)) remove.mutate(record); }}>Delete</Button></Card>)}
    <Card><h3 className="font-semibold">{editing ? "Edit bearer integration" : "Add bearer integration"}</h3>
      {!verification.data?.verification && verification.data && <p role="alert">Set up your unlock key above before adding bearer integrations.</p>}
      <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); setNotice(""); save.mutate(); }}>
        <Label>Name <Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label>
        <Label>HTTPS origin <Input required type="url" placeholder="https://api.example.com" value={origin} onChange={event => setOrigin(event.target.value)} /></Label>
        <Label>Description or help (optional) <Input maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></Label>
        <Label>{editing ? "Replacement bearer token" : "Bearer token"} <Input required type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} /></Label>
        <Label>Unlock key <Input required type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></Label>
        <div className="flex gap-2"><Button variant="primary" disabled={save.isPending || !verification.data?.verification}>{save.isPending ? "Encrypting and saving…" : editing ? "Save replacement" : "Add integration"}</Button>{editing && <Button type="button" onClick={reset}>Cancel</Button>}</div>
      </form>
    </Card>
    {notice && <p role={save.isError || remove.isError ? "alert" : "status"}>{notice}</p>}
  </section>;
}
