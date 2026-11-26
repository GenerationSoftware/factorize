import { ActionMenu, actionButtonClasses, type MenuAction } from "../../shared/action-menu";
import type { ReactNode } from "react";
import { IntegrationIcon } from "./icon";
import { Badge, tableCellClasses, tableRowClasses } from "../../shared/ui";
import { IntegrationPolicy } from "./api-policies";
import { defaultColumn } from "./permissions";

const itemTitle = "text-base leading-normal font-semibold";
const itemSubtitle = "text-sm leading-relaxed text-slate-600 dark:text-slate-400";

export function ProviderTile({kind, name, description, count, onAdd, href}: {kind: string; name: string; description: string; count: number; onAdd?: () => void; href?: string}) {
  const label = `Add ${name} integration`;
  const plus = <span aria-hidden="true">+</span>;
  return <li className="flex min-h-20 items-center gap-3 border-t border-stone-200 bg-white px-4 py-3 first:border-t-0 dark:border-slate-800 dark:bg-slate-900">
    {href ? <a href={href} className={actionButtonClasses} aria-label={label}>{plus}</a> : <button type="button" className={actionButtonClasses} aria-label={label} onClick={onAdd}>{plus}</button>}
    <IntegrationIcon kind={kind} />
    <span className="min-w-0 flex-1 text-left"><span className={`block ${itemTitle}`}>{name}</span><span className={`block ${itemSubtitle}`}>{description}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{count} {count === 1 ? "integration" : "integrations"}</span></span>
  </li>;
}
export type IntegrationAction = MenuAction;
export function IntegrationRow({kind, credentialId, name, detail, actionName, status, actions, children}: {kind: string; credentialId: string; name: string; detail?: string; actionName?: string; status?: string; actions: IntegrationAction[]; children?: ReactNode}) {
  const instance = actionName ?? (detail ? `${name} · ${detail}` : name);
  return <tr className={tableRowClasses}>
    <th scope="row" className={`${tableCellClasses} text-left font-normal`}>
      <div className="flex items-center gap-2 sm:gap-3">
        {actions.length > 0 && <ActionMenu align="start" name={instance} actions={actions} />}
        <div className="hidden shrink-0 sm:block"><IntegrationIcon kind={kind} /></div>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className={itemTitle}>{name}</p>
          {detail && <p className={itemSubtitle}>{detail}</p>}
          {status && <Badge active={false}>{status}</Badge>}
          {children}
        </div>
      </div>
    </th>
    <td className={defaultColumn}><IntegrationPolicy kind={kind} credentialId={credentialId} name={instance} /></td>
  </tr>;
}
