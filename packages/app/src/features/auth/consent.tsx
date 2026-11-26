import { Button, Input, Label, Page } from "../../shared/ui";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "./session";

export function ConsentScreen() {
  const authorizationQuery = location.search.slice(1);
  const [selection, setSelection] = useState<{ request: string; scopes: string[] }>();
  const preview = useQuery({
    queryKey: ["consent", authorizationQuery],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.POST("/api/v1/oauth/consent/preview", { signal, body: { authorizationQuery } });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });
  const data = preview.data;
  const scopes = data && selection?.request === data.request ? selection.scopes : (data?.selectedScopes ?? []);
  const stepUp = data?.scopes.filter(scope => data.newScopes?.includes(scope)) ?? [];
  const groups = stepUp.length && data ? [
    { title: "Existing and optional permissions", scopes: data.scopes.filter(scope => !stepUp.includes(scope)) },
    { title: "New permissions requested", scopes: stepUp },
  ] : [{ title: null, scopes: data?.scopes ?? [] }];
  const decision = useMutation({
    retry: false,
    mutationFn: async (value: "allow" | "deny") => {
      if (!data) throw new Error("Load the authorization request first.");
      const { data: result, error } = await api.POST("/api/v1/oauth/consent/decision", { body: { request: data.request, signature: data.signature, decision: value, scopes } });
      if (!result || error) throw new Error(messageOf(error));
      location.assign(result.redirectTo);
    },
  });
  const reload = () => {
    setSelection(undefined);
    decision.reset();
    void preview.refetch();
  };
  return <Page className="my-8 flex-none max-w-xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <h1 className="text-3xl font-semibold">{data?.reconnect ? "Reconnect" : "Authorize"} {data?.clientName ?? "a client"}</h1>
    {preview.isFetching && <p role="status">Validating authorization request…</p>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {data && !preview.isError && !preview.isFetching && <>
      <p>{data.reconnect ? "Review your saved choices and select the permissions to grant to the new token. Existing tokens won’t gain permissions." : "Select the workspace permissions to grant to this client."} Write does not imply read. Trigger writes can cause future schedule or webhook processing.</p>
      {!!data.unavailableSavedScopes?.length && <p role="status">The client did not request these saved permissions: {data.unavailableSavedScopes.join(", ")}. To grant them, update the client’s scope request and reconnect again.</p>}
      <fieldset disabled={decision.isPending || decision.isSuccess || decision.isError}>
        <legend>Permissions</legend>
        {groups.map(group => <div key={group.title ?? "permissions"} className="mb-3">
          {group.title && group.scopes.length > 0 && <h2 className="text-sm font-semibold">{group.title}</h2>}
          {group.scopes.map(scope => {
          const integration = data.integrationLabels?.find(label => label.scope === scope);
          return <Label className="block" key={scope}>
            <Input aria-label={scope} type="checkbox" checked={scopes.includes(scope)} onChange={e => setSelection({
              request: data.request,
              scopes: e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope),
            })} />
            {integration?.name ?? scope}
            {data.reconnect && <span className="ml-2 text-xs">
              {data.newScopes?.includes(scope) ? "New permission requested"
                : data.grantedScopes?.includes(scope) ? "Already granted" : "Optional permission"}
              {data.blockedScopes?.includes(scope) && " (blocked on current connection)"}
            </span>}
            {integration?.description && <span className="block text-sm">{integration.description}</span>}
          </Label>;
          })}
        </div>)}
      </fieldset>
      <p>Request expires {data.expiresAt}.</p>
      <Button variant="primary" disabled={decision.isPending || decision.isSuccess || decision.isError} onClick={() => decision.mutate("allow")}>Allow</Button>
      <Button disabled={decision.isPending || decision.isSuccess || decision.isError} onClick={() => decision.mutate("deny")}>Deny</Button>
    </>}
    {decision.error && <p role="alert">{decision.error.message}</p>}
    {(decision.isError || preview.isError) && <Button disabled={preview.isFetching} onClick={reload}>Reload authorization request</Button>}
  </Page>;
}
