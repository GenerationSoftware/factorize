import { useQuery } from "@tanstack/react-query";
import { Label, Select } from "../../shared/ui";
import { vmPresetsQuery, type VmPreset } from "./preset-queries";

export function PresetPicker({ availableIds, apply }: { availableIds: string[]; apply: (preset: VmPreset) => void }) {
  const presets = useQuery(vmPresetsQuery);
  if (presets.error) return <p role="alert">VM presets: {presets.error.message}</p>;
  return <Label>VM preset<Select value="" disabled={!presets.data?.length} onChange={event => {
    const preset = presets.data?.find(item => item.id === event.target.value);
    if (preset) apply(preset);
  }}>
    <option value="">{presets.isPending ? "Loading presets…" : presets.data?.length ? "Apply a preset…" : "No saved presets"}</option>
    {presets.data?.map(item => <option key={item.id} value={item.id} disabled={!availableIds.includes(item.executionConfigId)}>{item.name}</option>)}
  </Select></Label>;
}
