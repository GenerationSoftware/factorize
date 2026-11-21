import { ActionMenu, type MenuAction } from "../../shared/action-menu";
import { useState, type ReactNode } from "react";
import { IntegrationIcon } from "./icon";
import { Badge } from "../../shared/ui";
import { IntegrationPolicy, PolicyDialog, useIntegrationPolicy } from "./api-policies";

export function ProviderTile({kind, name, description, count, onAdd, href}: {kind: string; name: string; description: string; count: number; onAdd?: () => void; href?: string}) {
  const content = <><IntegrationIcon kind={kind} /><span className="min-w-0 flex-1 text-left"><span className="block font-semibold">{name}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{count} {count === 1 ? "integration" : "integrations"}</span></span><span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-stone-200 text-xl dark:border-slate-700" aria-hidden="true">+</span></>;
  const className = "flex min-h-20 w-full items-center gap-3 bg-white px-4 py-3 text-left transition hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-factorize-500 dark:bg-slate-900 dark:hover:bg-slate-800";
  return <li className="border-t border-stone-200 first:border-t-0 dark:border-slate-800">{href ? <a href={href} className={className} aria-label={`Add ${name} integration`}>{content}</a> : <button type="button" className={className} aria-label={`Add ${name} integration`} onClick={onAdd}>{content}</button>}</li>;
}
export type IntegrationAction = MenuAction;
export function IntegrationRow({kind, credentialId, name, detail, connected = true, status, actions, children}: {kind: string; credentialId: string; name: string; detail?: string; connected?: boolean; status?: string; actions: IntegrationAction[]; children?: ReactNode}) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const {row} = useIntegrationPolicy(kind, credentialId);
  return <div role="listitem" className="border-t border-stone-200 p-4 first:border-t-0 dark:border-slate-800"><div className="flex items-start gap-3"><IntegrationIcon kind={kind} /><div className="min-w-0 flex-1"><p className="break-words font-semibold">{name}</p>{detail && <p className="break-words text-sm text-slate-600 dark:text-slate-400">{detail}</p>}<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"><Badge active={connected}>{status ?? (connected ? "Connected" : "Needs attention")}</Badge><IntegrationPolicy kind={kind} credentialId={credentialId} name={name} /></div></div><ActionMenu name={name} actions={[...actions, ...(row ? [{label: "MCP access…", onClick: () => setPolicyOpen(true)}] : [])]} /></div>{children}{policyOpen && <PolicyDialog kind={kind} credentialId={credentialId} close={() => setPolicyOpen(false)} />}</div>;
}
