import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/query-client";
import { sessionQuery } from "./session";

/** Session changes in another tab must not leave another tenant's data visible. */
export function IdentityBoundary({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery);
  const previous = useRef<string | undefined>(undefined);
  const identity = session.data?.authenticated
    ? session.data.user.id + ":" + session.data.workspace.id + ":" + session.data.expiresAt
    : session.data ? "anonymous" : undefined;
  useEffect(() => {
    if (identity === undefined) return;
    if (previous.current !== undefined && previous.current !== identity) {
      void queryClient.cancelQueries({ predicate: query => query.queryKey[0] !== "session" });
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "session" });
    }
    previous.current = identity;
  }, [identity]);
  return children;
}
