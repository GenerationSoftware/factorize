import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Dialog } from "../../shared/dialog";
import { Button, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { clientsQuery } from "./queries";

export type AuthorizedClient = paths["/api/v1/access/authorized-clients"]["get"]["responses"][200]["content"]["application/json"][number];

export function ClientPermissions({ client, close }: { client: AuthorizedClient; close: () => void }) {
  const cache = useQueryClient();
  const [preset, setPreset] = useState("");
  const defaults = useQuery({
    queryKey: ["mcp-client", "team-permission-default"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/presets", { signal });
      if (error || !data) throw new Error(messageOf(error));
      return data.presets.find(entry => entry.kind === "permission" && entry.isDefault) ?? null;
    },
  });
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      const { error } = await api.PUT("/api/v1/access/authorizations/{grantId}/permissions", {
        params: { path: { grantId: client.grantId } },
        body: { preset: "team-default", expectedRevision: client.revision },
      });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: close,
    onSettled: () => Promise.all([
      cache.invalidateQueries({ queryKey: clientsQuery.queryKey }),
      cache.invalidateQueries({ queryKey: ["vm-attachments"] }),
    ]),
  });

  return <Dialog title={`Permissions for ${client.clientName}`} close={close}>
    <Label>Permission preset
      <Select value={preset} disabled={!defaults.data || save.isPending} onChange={event => setPreset(event.target.value)}>
        <option value="">Select a preset</option>
        <option value="team-default">Team default</option>
      </Select>
    </Label>
    {defaults.isPending && <p role="status">Loading team default…</p>}
    {defaults.isSuccess && !defaults.data && <p>Team default is unavailable.</p>}
    {defaults.error && <p role="alert">{defaults.error.message}</p>}
    {save.error && <p role="alert">{save.error.message}</p>}
    <Button variant="primary" disabled={!preset || !defaults.data || save.isPending} onClick={() => save.mutate()}>Save permissions</Button>
  </Dialog>;
}
