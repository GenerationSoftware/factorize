import { ActionMenu, actionButtonClasses, type MenuAction } from "../../shared/action-menu";
import type { ReactNode } from "react";
import { IntegrationIcon } from "./icon";
import { Badge } from "../../shared/ui";
import { IntegrationPolicy } from "./api-policies";

export function ProviderTile({kind, name, description, count, onAdd, href}: {kind: string; name: string; description: string; count: number; onAdd?: () => void; href?: string}) {
  const label = `Add ${name} integration`;
  const plus = <span aria-hidden="true">+</span>;
  return <li className="flex min-h-20 items-center gap-3 border-t border-stone-200 bg-white px-4 py-3 first:border-t-0 dark:border-slate-800 dark:bg-slate-900">
    {href ? <a href={href} className={actionButtonClasses} aria-label={label}>{plus}</a> : <button type="button" className={actionButtonClasses} aria-label={label} onClick={onAdd}>{plus}</button>}
    <IntegrationIcon kind={kind} />
    <span className="min-w-0 flex-1 text-left"><span className="block font-semibold">{name}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{count} {count === 1 ? "integration" : "integrations"}</span></span>
  </li>;
}
export type IntegrationAction = MenuAction;
export function IntegrationRow({kind, credentialId, name, detail, connected = true, status, actions, children}: {kind: string; credentialId: string; name: string; detail?: string; connected?: boolean; status?: string; actions: IntegrationAction[]; children?: ReactNode}) {
  return <div role="listitem" className="border-t border-stone-200 px-4 py-3 first:border-t-0 dark:border-slate-800">
    <div className="grid grid-cols-[2.5rem_2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 lg:grid-cols-[2.5rem_2.5rem_minmax(8rem,1fr)_minmax(0,1.2fr)_auto_auto]">
      <div className="col-start-1 row-span-2 row-start-1 lg:col-start-auto lg:row-span-1 lg:row-start-auto"><ActionMenu align="start" name={name} actions={actions} /></div>
      <div className="row-span-2 lg:row-span-1"><IntegrationIcon kind={kind} /></div>
      <p className="col-start-3 row-start-1 min-w-0 break-words font-semibold lg:col-start-auto lg:row-start-auto">{name}</p>
      <p className="col-start-3 row-start-2 min-w-0 break-words text-sm text-slate-600 dark:text-slate-400 lg:col-start-auto lg:row-start-auto">{detail || "—"}</p>
      <div className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 lg:contents"><Badge active={connected}>{status ?? (connected ? "Connected" : "Needs attention")}</Badge><IntegrationPolicy kind={kind} credentialId={credentialId} /></div>
    </div>{children}
  </div>;
}
