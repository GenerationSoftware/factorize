import { useEffect, useRef, useState, type ReactNode } from "react";
import { IntegrationIcon } from "./icon";
import { Badge } from "../../shared/ui";
import { IntegrationPolicy, PolicyDialog, useIntegrationPolicy } from "./api-policies";

export function ProviderTile({kind, name, description, count, onAdd, href}: {kind: string; name: string; description: string; count: number; onAdd?: () => void; href?: string}) {
  const content = <><span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-stone-200 text-xl dark:border-slate-700" aria-hidden="true">+</span><IntegrationIcon kind={kind} /><span className="font-semibold">{name}</span><span className="text-xs text-slate-600 dark:text-slate-400">{count} {count === 1 ? "integration" : "integrations"}</span><span className="text-xs text-slate-500 dark:text-slate-400">{description}</span></>;
  const className = "relative flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-5 text-center transition hover:border-factorize-500 focus-visible:outline-2 focus-visible:outline-factorize-500 dark:border-slate-700 dark:bg-slate-900";
  return href ? <a href={href} className={className} aria-label={`Add ${name} integration`}>{content}</a> : <button type="button" className={className} aria-label={`Add ${name} integration`} onClick={onAdd}>{content}</button>;
}
export type IntegrationAction = {label: string; onClick?: () => void; href?: string; external?: boolean; destructive?: boolean; disabled?: boolean};
function ActionMenu({name, actions}: {name: string; actions: IntegrationAction[]}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: MouseEvent) => {if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;};
    const escape = (event: KeyboardEvent) => {if (event.key === "Escape" && ref.current?.open) {ref.current.open = false; ref.current.querySelector("summary")?.focus();}};
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => {document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape);};
  }, []);
  return <details ref={ref} className="relative shrink-0"><summary aria-label={`Actions for ${name}`} className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border border-stone-200 text-xl hover:bg-stone-100 dark:border-slate-700 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">⋯</summary><div className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">{actions.map(action => {
    const className = `flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-slate-800 disabled:opacity-50 ${action.destructive ? "text-red-700 dark:text-red-400" : ""}`;
    const close = () => {if (ref.current) {ref.current.open = false; ref.current.querySelector("summary")?.focus();} action.onClick?.();};
    return action.href ? <a key={action.label} href={action.href} onClick={close} className={className} {...(action.external ? {target: "_blank", rel: "noreferrer"} : {})}>{action.label}</a> : <button type="button" key={action.label} disabled={action.disabled} onClick={close} className={className}>{action.label}</button>;
  })}</div></details>;
}
export function IntegrationRow({kind, credentialId, name, detail, connected = true, status, actions, children}: {kind: string; credentialId: string; name: string; detail?: string; connected?: boolean; status?: string; actions: IntegrationAction[]; children?: ReactNode}) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const {row} = useIntegrationPolicy(kind, credentialId);
  return <div role="listitem" className="border-t border-stone-200 p-4 first:border-t-0 dark:border-slate-800"><div className="flex items-start gap-3"><IntegrationIcon kind={kind} /><div className="min-w-0 flex-1"><p className="break-words font-semibold">{name}</p>{detail && <p className="break-words text-sm text-slate-600 dark:text-slate-400">{detail}</p>}<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"><Badge active={connected}>{status ?? (connected ? "Connected" : "Needs attention")}</Badge><IntegrationPolicy kind={kind} credentialId={credentialId} name={name} /></div></div><ActionMenu name={name} actions={[...actions, ...(row ? [{label: "MCP access…", onClick: () => setPolicyOpen(true)}] : [])]} /></div>{children}{policyOpen && <PolicyDialog kind={kind} credentialId={credentialId} close={() => setPolicyOpen(false)} />}</div>;
}
