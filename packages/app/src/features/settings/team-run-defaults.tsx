import { ProviderCredentials } from "../jobs/provider-credentials";
import { RunPermissions } from "../jobs/run-permissions";
import { LifecycleSelector } from "../jobs/lifecycle-selector";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type operations } from "factorize-api-client";
import { Button, Card, Input, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";
import { targetsQuery } from "../jobs/editor-queries";
import { PresetPicker } from "../settings/preset-picker";
import { flyConfigurationsQuery } from "../settings/fly";


type Defaults =
  operations["put_api_v1_team_run_defaults"]["requestBody"]["content"]["application/json"];

export function TeamRunDefaults({ initial, section="vm", onSave }: { initial: Defaults; section?:"vm"|"permissions"; onSave?:(draft:Defaults)=>Promise<void> }) {
  const [draft, setDraft] = useState<Defaults>(initial);
  const targets = useQuery(targetsQuery),
    fly = useQuery(flyConfigurationsQuery),
    cache = useQueryClient();
  const isFly = fly.data?.some((item) => item.id === draft.executionConfigId);
  const accounts = useQuery({
    queryKey: ["team-run-model-accounts"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/model-accounts");
      if (!data || error) throw new Error(messageOf(error));
      return data.accounts;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if(onSave){await onSave(draft);return;}
      const latest = await api.GET("/api/v1/team");
      if(!latest.data || latest.error)throw new Error(messageOf(latest.error));
      const merged = {...latest.data.runDefaults};
      const permissionKeys = ["runScopes","portableIntegrationIds","githubInstallationIds","linearConnectionId","xConnectionIds","allowedTriggerIds"] as const;
      for (const key of Object.keys({...initial,...draft}) as (keyof Defaults)[]) {
        if (permissionKeys.includes(key as typeof permissionKeys[number]) === (section === "permissions")) {
          delete merged[key];
          if(draft[key] !== undefined)Object.assign(merged,{[key]:draft[key]});
        }
      }
      const { error } = await api.PUT("/api/v1/team/run-defaults", {
        body: merged,
      });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["team"] }),
  });
  return (
    <Card className="mt-5 max-w-2xl">
      <h2>{section === "vm" ? "Execution defaults" : "Permission defaults"}</h2><p className="mt-2 text-sm">{onSave ? "These settings apply to future manual and event-triggered runs of this skill." : "New skills copy these settings. Changes also apply to runs started without a skill."}</p>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {section === "vm" && <><Label><input type="checkbox" checked={Boolean(draft.requiresVm)} onChange={event=>setDraft({...draft,requiresVm:event.target.checked,...(!event.target.checked?{executionConfigId:undefined,vmImage:undefined,tags:[]}: {})})} /> Requires VM for agent runs</Label>
        <PresetPicker availableIds={[...(targets.data ?? []), ...(fly.data ?? [])].map(item => item.id)} apply={preset => {
          const settings = preset.settings;
          setDraft({ ...draft,requiresVm:true, executionConfigId: preset.executionConfigId, vmImage: settings.provider === "exe" ? settings.image : undefined,
            tags: settings.provider === "exe" ? settings.tags : [] });
        }} />
        <Label>
          VM configuration
          <Select
            value={draft.executionConfigId ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                executionConfigId: event.target.value || undefined,
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
                  {item.name} · {item.id}
                </option>
              ))}
            {fly.data?.filter(item => !item.presetName || item.id === draft.executionConfigId).map((item) => (
              <option key={item.id} value={item.id}>
                Fly · {item.presetName ?? item.name}
              </option>
            ))}
          </Select>
        </Label>
        </>}
        {section === "permissions" && <fieldset className="space-y-4 rounded border p-4"><legend>Permissions</legend>
        <RunPermissions value={draft.runScopes ?? []} onChange={runScopes => setDraft({...draft,runScopes})} />
        <ProviderCredentials value={draft} onChange={value => setDraft({...draft,...value})} />
        <LifecycleSelector kind="destination" selected={draft.allowedTriggerIds ?? []} onChange={allowedTriggerIds => setDraft({...draft,allowedTriggerIds})} />
        <Button type="button" onClick={() => setDraft({...draft,allowedTriggerIds:[]})}>Clear destination defaults</Button>
        </fieldset>}
        {section === "vm" && <>
        <Label>
            Model account
            <Select
              value={draft.modelAccountId ?? ""}
              onChange={(event) => setDraft({ ...draft, modelAccountId: event.target.value || undefined })}
            >
              <option value="">Choose a model account</option>
              {accounts.data?.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.credentialConfigured}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Label>
        <Label>
          Model
          <Input
            value={draft.model ?? ""}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        </Label>
        <Label>{onSave ? "Skill concurrency limit" : "Default skill concurrency limit"}<Input type="number" min={1} max={50} value={draft.concurrencyLimit ?? 1} onChange={event => setDraft({...draft,concurrencyLimit:event.target.valueAsNumber})} /></Label>
        <Label>VM image<Input value={draft.vmImage ?? ""} onChange={event => setDraft({...draft,vmImage:event.target.value})} /></Label>
        {!onSave && <Label>
          Team concurrency limit
          <Input
            type="number"
            min={1}
            max={50}
            required
            value={draft.capacity ?? ""}
            onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
          />
        </Label>}
        </>}
        {save.error && <p role="alert">{save.error.message}</p>}
        {save.isSuccess && <p role="status">Run defaults saved.</p>}
        <Button type="submit" disabled={save.isPending}>
          Save run defaults
        </Button>
      </form>
    </Card>
  );
}
