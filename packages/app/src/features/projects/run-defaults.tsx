import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type operations } from "factorize-api-client";
import { Button, Card, Input, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { targetsQuery } from "../jobs/editor-queries";
import { PresetPicker } from "../settings/preset-picker";
import { flyConfigurationsQuery } from "../settings/fly";
import { projectQuery } from "./queries";

type Defaults =
  operations["put_api_v1_projects_projectId_run_defaults"]["requestBody"]["content"]["application/json"];

export function ProjectRunDefaults({ projectId, initial }: { projectId: string; initial?: Defaults }) {
  const [draft, setDraft] = useState<Defaults>(initial ?? { executionConfigId: "", capacity: 4 });
  const targets = useQuery(targetsQuery),
    fly = useQuery(flyConfigurationsQuery),
    cache = useQueryClient();
  const isFly = fly.data?.some((item) => item.id === draft.executionConfigId);
  const accounts = useQuery({
    enabled: !!isFly,
    queryKey: ["project-run-model-accounts"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/model-accounts");
      if (!data || error) throw new Error(messageOf(error));
      return data.accounts;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT("/api/v1/projects/{projectId}/run-defaults", {
        params: { path: { projectId } },
        body: draft,
      });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: projectQuery(projectId).queryKey }),
  });
  return (
    <Card className="mt-5 max-w-2xl">
      <h2>Direct run defaults</h2>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <PresetPicker availableIds={[...(targets.data ?? []), ...(fly.data ?? [])].map(item => item.id)} apply={preset => {
          const settings = preset.settings;
          setDraft({ ...draft, executionConfigId: preset.executionConfigId, vmImage: settings.provider === "exe" ? settings.image : undefined,
            tags: settings.provider === "exe" ? settings.tags : [], modelAccountId: settings.provider === "fly" ? draft.modelAccountId : undefined });
        }} />
        <Label>
          VM configuration
          <Select
            required
            value={draft.executionConfigId}
            onChange={(event) =>
              setDraft({
                ...draft,
                executionConfigId: event.target.value,
                modelAccountId: undefined,
                model: "",
                effort: undefined,
                vmImage: undefined,
                tags: [],
              })
            }
          >
            <option value="">Choose a VM configuration</option>
            {targets.data
              ?.filter((item) => item.kind === "exe")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.agentKind} · {item.id}
                </option>
              ))}
            {fly.data?.filter(item => !item.presetName || item.id === draft.executionConfigId).map((item) => (
              <option key={item.id} value={item.id}>
                Fly · {item.presetName ?? item.name}
              </option>
            ))}
          </Select>
        </Label>
        {isFly && (
          <Label>
            Model account
            <Select
              required
              value={draft.modelAccountId ?? ""}
              onChange={(event) => setDraft({ ...draft, modelAccountId: event.target.value })}
            >
              <option value="">Choose a model account</option>
              {accounts.data?.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.credentialConfigured}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Label>
        )}
        <Label>
          Model
          <Input
            value={draft.model ?? ""}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </Label>
        <Label>
          Project concurrency limit
          <Input
            type="number"
            min={1}
            max={50}
            required
            value={draft.capacity ?? ""}
            onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
          />
        </Label>
        {save.error && <p role="alert">{save.error.message}</p>}
        {save.isSuccess && <p role="status">Run defaults saved.</p>}
        <Button type="submit" disabled={save.isPending}>
          Save run defaults
        </Button>
      </form>
    </Card>
  );
}
