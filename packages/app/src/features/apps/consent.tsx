import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { Button, Card, Page } from "../../shared/ui";
import { messageOf } from "../auth/session";

const scopeLabel = (scope: string) => ({
  openid: "Your Factorize identity",
  email: "Your verified email address",
  offline_access: "Access when you’re away",
} as Record<string, string>)[scope] ?? scope;

export function AppConsentPage() {
  const { request: requestId } = useSearch({ from: "/app-consent" });
  const preview = useQuery({
    queryKey: ["app-consent", requestId],
    enabled: Boolean(requestId),
    retry: false,
    queryFn: async ({ signal }) => {
      const { error, data } = await api.GET("/api/v1/app-consent/{requestId}", { params: { path: { requestId: requestId! } }, signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const decide = useMutation({
    retry: false,
    mutationFn: async (decision: "allow" | "deny") => {
      const { error, data } = await api.POST("/api/v1/app-consent/decision", { body: { requestId: requestId!, decision } });
      if (!data || error) throw new Error(messageOf(error));
      window.location.assign(data.redirectTo);
    },
  });
  return <Page className="max-w-xl"><Card>
    <h1>Sign in with Factorize</h1>
    {!requestId && <p role="alert">This sign-in request is missing.</p>}
    {requestId && preview.isPending && <p role="status">Loading sign-in request…</p>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {decide.error && <p role="alert">{decide.error.message}</p>}
    {preview.data && <>
      <p className="my-3"><strong>{preview.data.appName}</strong> is requesting access to:</p>
      <ul className="mb-5 list-disc space-y-1 pl-6">{preview.data.scopes.map(scope => <li key={scope}>{scopeLabel(scope)}</li>)}</ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" disabled={decide.isPending} onClick={() => decide.mutate("allow")}>Allow</Button>
        <Button disabled={decide.isPending} onClick={() => decide.mutate("deny")}>Deny</Button>
      </div>
    </>}
  </Card></Page>;
}
