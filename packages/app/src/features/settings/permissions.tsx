import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Label, Select } from "../../shared/ui";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";

const path = "/api/v1/team-permissions";
const key = ["settings", "team-permissions"];
export function useTeamPermissions() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(path, { signal });
    if (!Array.isArray(data) || error) throw new Error(error ? messageOf(error) : "Could not load team permissions.");
    return data;
  }});
  const change = useMutation({ retry: false, mutationFn: async (body: {scope:string;isDefault:boolean}) => {
    const { error } = await api.PUT(path, { body });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: (_, change) => {
    cache.setQueryData<typeof query.data>(key, rows => rows?.map(row => row.scope === change.scope
      ? { ...row, isDefault: change.isDefault, preferenceSet: true } : row));
    return cache.invalidateQueries({ queryKey: key });
  }});
  return { query, change };
}
export type TeamPermission = NonNullable<ReturnType<typeof useTeamPermissions>["query"]["data"]>[number];
export function PermissionChoice({ row, settings }: {row:TeamPermission;settings:ReturnType<typeof useTeamPermissions>}) {
  const pending = settings.change.isPending && settings.change.variables.scope === row.scope ? settings.change.variables : null;
  const value = pending ? (pending.isDefault ? "default" : "not-default")
    : !row.preferenceSet ? "" : row.isDefault ? "default" : "not-default";
  return <>
    <Label className="flex flex-wrap items-center gap-2">{row.name}
      <Select value={value} aria-label={row.name + " default preference"} disabled={settings.change.isPending || !row.available}
        onChange={event => settings.change.mutate({ scope: row.scope, isDefault: event.target.value === "default" })}>
        {!row.preferenceSet && <option value="" disabled>Choose a default preference</option>}
        <option value="default">Default</option><option value="not-default">Not default</option>
      </Select>
    </Label>
    {!row.available && <p className="text-xs">Integration unavailable</p>}
    {settings.change.variables?.scope === row.scope && settings.change.error && <p role="alert">{settings.change.error.message}</p>}
  </>;
}
export function Permissions() {
  const settings = useTeamPermissions();
  return <SettingsLayout title="Permissions">
    <p className="mb-5">Defaults preselect permissions for new connections. They do not grant access or change existing permissions.</p>
    {settings.query.error && <p role="alert">{settings.query.error.message}</p>}
    {settings.query.isPending && <p role="status">Loading permissions...</p>}
    <ul className="divide-y rounded-xl border dark:border-slate-800">{settings.query.data?.map(row =>
      <li key={row.scope} className="p-4"><PermissionChoice row={row} settings={settings}/></li>)}</ul>
  </SettingsLayout>;
}
