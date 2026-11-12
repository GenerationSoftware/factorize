import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label } from "../../shared/ui";
import { encryptModelAccountCacheRecord, verifyUnlockKey } from "../../lib/unlock-crypto";
import { getUnlockVerification } from "../../lib/unlock-key";
import { messageOf } from "../auth/session";

type DeviceState = { state: string; verificationUrl?: string; userCode?: string };
type ModelAccount = { id: string; name: string; description: string | null; revision: number };
const accountsQuery = { queryKey: ["settings", "model-accounts"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/model-accounts", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data;
} };
const verificationQuery = { queryKey: ["unlock-key-verification"], queryFn: ({ signal }: { signal: AbortSignal }) => getUnlockVerification(signal), retry: false as const };

async function proxyAction(accountId: string, action: "authorize" | "status" | "cancel"): Promise<DeviceState> {
  const capability = await api.POST("/api/v1/model-accounts/{accountId}/browser-capability", {
    params: { path: { accountId } }, body: { action },
  });
  if (!capability.data || capability.error) throw new Error(messageOf(capability.error));
  const response = await fetch(capability.data.endpoint, {
    method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
    headers: { Authorization: `Bearer ${capability.data.capability}`, "Content-Type": "application/json" },
    body: "{}",
  });
  let result: DeviceState;
  try { result = await response.json() as DeviceState; }
  catch { throw new Error("The credential proxy returned an invalid response."); }
  if (!response.ok) {
    const messages: Record<number, string> = { 423: "Unlock the credential proxy before connecting a model account.", 503: "The credential proxy is unavailable. Try again shortly." };
    throw new Error(messages[response.status] ?? "The credential proxy could not complete this request.");
  }
  return result;
}

export function ModelAccounts() {
  const cache = useQueryClient(), accounts = useQuery(accountsQuery), verification = useQuery(verificationQuery);
  const [active, setActive] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, DeviceState>>({});
  const [error, setError] = useState("");
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [key, setKey] = useState("");

  const create = useMutation({ retry: false, mutationFn: async () => {
    const cleanName = name.trim(), cleanDescription = description.trim();
    if (!cleanName || cleanName.length > 120) throw new Error("Enter a name up to 120 characters.");
    if (cleanDescription.length > 500) throw new Error("Description must be at most 500 characters.");
    const setup = verification.data?.verification;
    if (!setup || !verification.data) throw new Error("Set up an unlock key before adding a model account.");
    if (!accounts.data) throw new Error("Model accounts are still loading. Try again shortly.");
    try { await verifyUnlockKey(key, verification.data.ownerId, setup.generationId, JSON.parse(setup.encryptedVerification)); }
    catch { throw new Error("Unlock key could not be verified for this account and generation."); }
    const id = crypto.randomUUID(), expectedRevision = accounts.data.revision;
    const encryptedPayload = await encryptModelAccountCacheRecord(new TextEncoder().encode("{}"), key, {
      ownerId: verification.data.ownerId, recordId: id, recordType: "model", destination: "factorize",
      keyGeneration: setup.generationId, revision: expectedRevision + 1,
    });
    const { data, error } = await api.POST("/api/v1/model-accounts", { body: {
      id, expectedRevision, idempotencyKey: crypto.randomUUID(), name: cleanName,
      description: cleanDescription || null, encryptedPayload,
    } });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }, onSuccess: async () => {
    setName(""); setDescription(""); setKey(""); setError("");
    await cache.invalidateQueries({ queryKey: accountsQuery.queryKey });
  }, onError: async reason => {
    setKey(""); setError(reason.message);
    if (reason.message.includes("changed") || reason.message.includes("revision")) await cache.invalidateQueries({ queryKey: accountsQuery.queryKey });
  } });

  const remove = useMutation({ retry: false, mutationFn: async (account: ModelAccount) => {
    if (!accounts.data) throw new Error("Model accounts are still loading. Try again shortly.");
    const { data, error } = await api.DELETE("/api/v1/model-accounts/{accountId}", {
      params: { path: { accountId: account.id } },
      body: { expectedRevision: accounts.data.revision, idempotencyKey: crypto.randomUUID() },
    });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }, onSuccess: async () => {
    setError(""); await cache.invalidateQueries({ queryKey: accountsQuery.queryKey });
  }, onError: async reason => {
    setError(reason.message); await cache.invalidateQueries({ queryKey: accountsQuery.queryKey });
  } });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await proxyAction(active, "status");
        if (stopped) return;
        setStates(current => ({ ...current, [active]: next }));
        if (next.state !== "pending") setActive(null);
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Could not check model account authorization.");
      }
    };
    const timer = window.setInterval(poll, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [active]);

  const run = async (account: ModelAccount, action: "authorize" | "cancel") => {
    setError("");
    try {
      const next = await proxyAction(account.id, action);
      setStates(current => ({ ...current, [account.id]: next }));
      setActive(action === "authorize" && next.state === "pending" ? account.id : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect the model account.");
    }
  };

  return <section className="mt-10 space-y-4" aria-labelledby="model-accounts-heading">
    <div><h2 id="model-accounts-heading" className="text-2xl font-bold">ChatGPT model accounts</h2><p className="text-sm text-slate-600 dark:text-slate-400">Connect each account through Codex device authorization. Credentials stay in the credential proxy.</p></div>
    {accounts.isPending && <p role="status">Loading model accounts…</p>}
    {accounts.error && <p role="alert">{accounts.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    {!accounts.isPending && accounts.data?.accounts.length === 0 && <Card><p>No model accounts are configured yet.</p></Card>}
    {accounts.data?.accounts.map(account => {
      const state = states[account.id] ?? { state: "idle" };
      return <Card key={account.id} className="flex flex-wrap items-start gap-3">
        <div className="min-w-40 flex-1"><p className="font-semibold">{account.name}</p>{account.description && <p>{account.description}</p>}
          {state.state === "pending" && <div className="mt-2 space-y-1" role="status"><p>Waiting for device authorization.</p>{state.userCode && <p>Code: <strong className="select-all">{state.userCode}</strong></p>}{state.verificationUrl && <a className="underline" href={state.verificationUrl} target="_blank" rel="noreferrer">OpenAI device authorization</a>}</div>}
          {state.state === "authorized" && <p role="status">ChatGPT account connected.</p>}
          {state.state === "authorized-unsaved" && <p role="alert">ChatGPT account connected, but its encrypted token cache could not be saved. Keep the proxy running and retry after checking its connection.</p>}
          {state.state === "reauthentication-required" && <p role="alert">Sign in again to reconnect this account.</p>}
          {state.state === "failed" && <p role="alert">Device authorization failed. You can try again.</p>}
          {state.state === "canceled" && <p role="status">Device authorization canceled.</p>}
        </div>
        {state.state === "pending" ? <Button disabled={active !== account.id} onClick={() => void run(account, "cancel")}>Cancel authorization</Button> : <Button disabled={Boolean(active) || remove.isPending} onClick={() => void run(account, "authorize")}>Connect ChatGPT</Button>}
        <Button variant="destructive" disabled={remove.isPending || active === account.id} onClick={() => { if (window.confirm(`Delete ${account.name}? Its proxy cache will be removed during the next unlock reconciliation.`)) remove.mutate(account); }}>Delete account</Button>
      </Card>;
    })}
    <Card><h3 className="font-semibold">Add a model account</h3>
      {!verification.data?.verification && verification.data && <p role="alert">Set up your unlock key above before adding a model account.</p>}
      <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); setError(""); create.mutate(); }}>
        <Label>Name <Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label>
        <Label>Description (optional) <Input maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></Label>
        <Label>Unlock key <Input required type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></Label>
        <Button variant="primary" disabled={create.isPending || accounts.isPending || Boolean(accounts.error) || !verification.data?.verification}>{create.isPending ? "Encrypting and saving…" : "Add model account"}</Button>
      </form>
    </Card>
  </section>;
}
