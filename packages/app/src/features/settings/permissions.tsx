import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Input, Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";

const path = "/api/v1/team-permissions";
const key = ["settings", "team-permissions"];
export function useTeamPermissions() {
  return useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(path, { signal });
    if (!Array.isArray(data) || error) throw new Error(error ? messageOf(error) : "Could not load team permissions.");
    return data;
  }});
}
export type TeamPermission = NonNullable<ReturnType<typeof useTeamPermissions>["data"]>[number];
export const defaultColumn = `${tableCellClasses} w-32 text-center sm:w-40`;

export function DefaultCheckbox({ row, name = row.name }: { row: TeamPermission; name?: string }) {
  const cache = useQueryClient();
  const detail = useId();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  // Each row owns its pending state and rollback; another row can save meanwhile.
  const change = useMutation({ retry: false, mutationFn: async (isDefault: boolean) => {
    await cache.cancelQueries({ queryKey: key, exact: true });
    const { error } = await api.PUT(path, { body: { scope: row.scope, isDefault } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: (_, isDefault) => {
    cache.setQueryData<TeamPermission[]>(key, rows => rows?.map(item => item.scope === row.scope
      ? { ...item, isDefault, preferenceSet: true } : item));
  }, onSettled: () => setOptimistic(null) });
  const status = change.error?.message || (!row.available ? "Integration unavailable" : null);
  return <div aria-busy={optimistic !== null}>
    <label className="mx-auto flex size-10 items-center justify-center rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-factorize-600">
      <Input type="checkbox" className="mr-0" aria-label={`${name}: Available by Default`} aria-describedby={status ? detail : undefined}
        checked={optimistic ?? row.isDefault} disabled={optimistic !== null || !row.available}
        onChange={event => { const checked = event.currentTarget.checked; setOptimistic(checked); change.mutate(checked); }} />
    </label>
    {status && <p id={detail} className="break-words text-xs" role={change.error ? "alert" : undefined}>{status}</p>}
  </div>;
}

export function Permissions() {
  const query = useTeamPermissions();
  const native = query.data?.filter(row => row.integrationId === null);
  return <SettingsLayout title="Permissions">
    <p className="mb-5">Defaults preselect permissions for new connections. They do not grant access or change existing permissions.</p>
    {query.error && <p role="alert">{query.error.message}</p>}
    {query.isPending && <p role="status">Loading permissions…</p>}
    {native && <Table aria-label="Factorize permissions">
      <thead className={tableHeadClasses}><tr><th scope="col" className={tableCellClasses}>Permission</th><th scope="col" className={defaultColumn}>Available by Default</th></tr></thead>
      <tbody>{native.map(row => <tr key={row.scope} className={tableRowClasses}>
        <th scope="row" className={`${tableCellClasses} break-words font-medium`}>{row.name}</th>
        <td className={defaultColumn}><DefaultCheckbox row={row} /></td>
      </tr>)}</tbody>
    </Table>}
  </SettingsLayout>;
}
