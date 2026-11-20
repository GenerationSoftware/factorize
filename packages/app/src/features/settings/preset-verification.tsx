import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button } from "../../shared/ui";
import { messageOf } from "../auth/session";

export function PresetVerification({ connectionId, image, tags }: {
  connectionId: string; image: string; tags: string[];
}) {
  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/vm-image-verifications", { body: { connectionId, image, tags } });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const id = start.data?.id;
  const progress = useQuery({
    queryKey: ["vm-image-verification", id], enabled: !!id,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/vm-image-verifications/{verificationId}", { params: { path: { verificationId: id! } }, signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    refetchInterval: query => ["succeeded", "failed", "cleanup_failed"].includes(query.state.data?.status ?? "") ? false : 1500,
  });
  const status = progress.data ?? start.data;
  const pending = start.isPending || (status && !["succeeded", "failed", "cleanup_failed"].includes(status.status));
  return <div>
    <Button type="button" disabled={Boolean(pending)} onClick={() => start.mutate()}>Verify image</Button>
    {status && <p role="status">{status.status} · {status.error ?? status.phase}</p>}
    {(start.error || progress.error) && <p role="alert">{(start.error ?? progress.error)?.message}</p>}
  </div>;
}
