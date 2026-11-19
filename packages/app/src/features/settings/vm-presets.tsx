import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label, Page, PageHeader, Select } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { integrationsQuery } from "./queries";
import { flyConfigurationsQuery, flyConnectionQuery, flyRegions, flySizes } from "./fly";
import { vmPresetsQuery, type VmPreset } from "./preset-queries";
import { PresetVerification } from "./preset-verification";

function summary({ settings }: VmPreset) {
  return settings.provider === "fly"
    ? ["Fly.io", settings.size, settings.region, settings.image].join(" · ")
    : ["exe.dev", ...settings.tags, settings.image || "Provider default image"].join(" · ");
}

export function VmPresets() {
  const presets = useQuery(vmPresetsQuery);
  const [editor, setEditor] = useState<VmPreset | "new" | null>(null);
  return <Page><PageHeader title="VM presets" description="Save VM settings to reuse across jobs.">
    <Button variant="primary" onClick={() => setEditor("new")}>Add preset</Button>
  </PageHeader>
    {presets.isPending && <p role="status">Loading VM presets…</p>}
    {presets.error && <p role="alert">{presets.error.message}</p>}
    {presets.data?.length === 0 && <p>No VM presets yet.</p>}
    {!!presets.data?.length && <ul aria-label="VM presets" className="divide-y rounded-xl border border-stone-200 dark:border-slate-700">
      {presets.data.map(preset => <li key={preset.id} className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0 break-words"><strong>{preset.name}</strong><p className="text-sm">{summary(preset)}</p></div>
        <Button aria-label={`Edit ${preset.name}`} onClick={() => setEditor(preset)}>Edit</Button>
      </li>)}
    </ul>}
    {editor && <PresetEditor initial={editor === "new" ? undefined : editor} presets={presets.data ?? []} close={() => setEditor(null)} />}
  </Page>;
}

function PresetEditor({ initial, presets, close }: { initial?: VmPreset; presets: VmPreset[]; close: () => void }) {
  const cache = useQueryClient();
  const integrations = useQuery(integrationsQuery), fly = useQuery(flyConnectionQuery), configurations = useQuery(flyConfigurationsQuery);
  const exe = integrations.data?.exeConnections ?? [];
  const options = [
    ...exe.map(item => ({ value: item.connectionId, label: `exe.dev · ${item.agentKind ?? "codex"} · ${item.connectionId}` })),
    ...(fly.data ? [{ value: "fly", label: `Fly.io · ${fly.data.organizationName}` }] : []),
  ];
  const existing = initial?.settings;
  const [name, setName] = useState(initial?.name ?? "");
  const [choice, setChoice] = useState(existing?.provider === "exe" ? existing.connectionId : existing?.provider ?? "");
  const provider = choice || (!integrations.isPending && !fly.isPending && options.length === 1 ? options[0].value : "");
  const connection = exe.find(item => item.connectionId === provider);
  const [region, setRegion] = useState(existing?.provider === "fly" ? existing.region : "iad");
  const [size, setSize] = useState(existing?.provider === "fly" ? existing.size : "shared-cpu-1x");
  const [tags, setTags] = useState(existing?.provider === "exe" ? existing.tags : []);
  const [selectedImage, setImageChoice] = useState<string | undefined>(existing?.image);
  const [customImage, setCustomImage] = useState("");
  const images = new Set(presets.filter(item => item.settings.provider === (provider === "fly" ? "fly" : "exe")).map(item => item.settings.image).filter(Boolean));
  if (provider === "fly") for (const item of configurations.data ?? []) images.add(item.image);
  const imageChoice = selectedImage ?? (provider === "fly" && images.size === 1 ? [...images][0] : "");
  if (imageChoice && imageChoice !== "custom:") images.add(imageChoice);
  const image = imageChoice === "custom:" ? customImage.trim() : imageChoice;
  const action = useMutation({
    mutationFn: async (kind: "save" | "delete") => {
      const settings: VmPreset["settings"] = provider === "fly" ? { provider: "fly", image, region, size } : { provider: "exe", image, tags, connectionId: provider };
      const body = { name: name.trim(), settings };
      const path = { id: initial?.id ?? "" };
      const result = kind === "delete" ? await api.DELETE("/api/v1/vm-presets/{id}", { params: { path } })
        : initial ? await api.PUT("/api/v1/vm-presets/{id}", { params: { path }, body }) : await api.POST("/api/v1/vm-presets", { body });
      if (result.error) throw new Error(messageOf(result.error));
    },
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: vmPresetsQuery.queryKey }), cache.invalidateQueries({ queryKey: flyConfigurationsQuery.queryKey })]);
      close();
    },
  });
  const available = options.some(option => option.value === provider);
  const duplicate = presets.some(item => item.id !== initial?.id && item.name.toLowerCase() === name.trim().toLowerCase());
  return <Dialog title={initial ? "Edit VM preset" : "Add VM preset"} close={close}>
    <form onSubmit={event => { event.preventDefault(); action.mutate("save"); }}>
      <fieldset disabled={action.isPending} className="grid gap-4">
        <Label>Preset name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Label>
        {duplicate && <p role="alert">A VM preset already uses this name.</p>}
        <Label>Execution provider<Select required value={provider} onChange={event => { setChoice(event.target.value); setTags([]); setImageChoice(undefined); setCustomImage(""); }}>
          <option value="">Choose a provider</option>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {provider && !available && <option value={provider}>Unavailable connection · {provider}</option>}
        </Select></Label>
        {(integrations.error || fly.error) && <p role="alert">{(integrations.error ?? fly.error)?.message}</p>}
        {!integrations.isPending && !fly.isPending && !options.length && <p><Link className="underline" to="/integrations">Connect a VM provider in Integrations</Link> to create a preset.</p>}
        {provider === "fly" && <div className="grid gap-4 sm:grid-cols-2">
          <Label>VM size<Select value={size} onChange={event => setSize(event.target.value)}>{flySizes.map(value => <option key={value}>{value}</option>)}</Select></Label>
          <Label>Region<Select value={region} onChange={event => setRegion(event.target.value)}>{flyRegions.map(value => <option key={value}>{value}</option>)}</Select></Label>
        </div>}
        {connection && (connection.accountTags?.length || tags.length) ? <fieldset><legend>VM tags</legend>
          {Array.from(new Set([...connection.accountTags ?? [], ...tags])).map(tag => <Label key={tag}>
            <input type="checkbox" checked={tags.includes(tag)} onChange={event => setTags(event.target.checked ? [...tags, tag] : tags.filter(value => value !== tag))} /> {tag}
          </Label>)}
        </fieldset> : null}
        {provider && <Label>VM image<Select value={imageChoice} onChange={event => setImageChoice(event.target.value)}>
          <option value="">{provider === "fly" ? "Choose an image" : "Provider default image"}</option>
          {[...images].map(value => <option key={value}>{value}</option>)}<option value="custom:">Enter image reference…</option>
        </Select></Label>}
        {imageChoice === "custom:" && <Label>Image reference<Input required maxLength={512} placeholder="ghcr.io/owner/image:tag" value={customImage} onChange={event => setCustomImage(event.target.value)} /></Label>}
        {connection && image && <PresetVerification key={JSON.stringify([provider, image, tags, connection.agentKind])} connectionId={provider} agentKind={connection.agentKind ?? "codex"} image={image} tags={tags} />}
        {action.error && <p role="alert">{action.error.message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!name.trim() || duplicate || !available || ((provider === "fly" || imageChoice === "custom:") && !image)}>Save preset</Button>
          <Button type="button" onClick={close}>Cancel</Button>
          {initial && <Button type="button" onClick={() => { if (window.confirm(`Delete "${initial.name}"? Jobs keep their saved VM settings.`)) action.mutate("delete"); }}>Delete preset</Button>}
        </div>
      </fieldset>
    </form>
  </Dialog>;
}
