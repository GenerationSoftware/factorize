import { api, type operations } from "factorize-api-client";
import { queryOptions } from "@tanstack/react-query";
import { messageOf } from "../auth/session";

export type VmPreset = operations["get_api_v1_vm_presets"]["responses"][200]["content"]["application/json"]["presets"][number];
export const vmPresetsQuery = queryOptions({
  queryKey: ["settings", "vm-presets"],
  queryFn: async ({ signal }) => {
    const { data, error } = await api.GET("/api/v1/vm-presets", { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data.presets;
  },
});

export type Preset = operations["get_api_v1_presets"]["responses"][200]["content"]["application/json"]["presets"][number];
export type PresetKind = Preset["kind"];
export type PresetInput = operations["post_api_v1_presets"]["requestBody"]["content"]["application/json"];
export const presetsQuery = queryOptions({queryKey:["settings","presets"],queryFn:async({signal})=>{
 const {data,error}=await api.GET("/api/v1/presets",{signal});if(!data||error)throw new Error(messageOf(error));return data.presets;
}});
export const presetSection = (kind:PresetKind) => kind==="permission"?"permissions":kind==="model"?"models":"vm";
export const presetType = (section:string):PresetKind => section==="permissions"?"permission":section==="models"?"model":"vm";
