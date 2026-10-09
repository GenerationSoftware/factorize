import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";

export function AccountBar() {
  const session = useQuery(sessionQuery);
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await api.POST("/api/v1/auth/logout");
      if (result.error) throw new Error(messageOf(result.error));
      await refreshIdentity();
    },
  });
  if (!session.data?.authenticated) return null;
  return (
    <aside className="flex flex-wrap items-center justify-end gap-3 border-b p-3" aria-label="Your account">
      <span>{session.data.user.email}</span>
      <button onClick={() => logout.mutate()} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
      {logout.isError && <p role="alert">{logout.error.message}</p>}
    </aside>
  );
}
