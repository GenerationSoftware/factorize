import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card } from "../../shared/ui";
import { messageOf } from "../auth/session";

type DeviceState = { state: string; verificationUrl?: string; userCode?: string };
type ModelAccount = { id: string; name: string; description: string | null; revision: number };
const accountsQuery = { queryKey: ["settings", "model-accounts"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/model-accounts", { signal });
  if (!data || error) throw new Error(messageOf(error));
  return data.accounts;
} };

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
  const accounts = useQuery(accountsQuery);
  const [active, setActive] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, DeviceState>>({});
  const [error, setError] = useState("");

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
    {!accounts.isPending && accounts.data?.length === 0 && <Card><p>No model accounts are configured yet.</p></Card>}
    {accounts.data?.map(account => {
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
        {state.state === "pending" ? <Button disabled={active !== account.id} onClick={() => void run(account, "cancel")}>Cancel authorization</Button> : <Button disabled={Boolean(active)} onClick={() => void run(account, "authorize")}>Connect ChatGPT</Button>}
      </Card>;
    })}
  </section>;
}
