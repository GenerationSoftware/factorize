import type { ReactNode } from "react";
import { Page } from "../../shared/ui";
import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";
export function SettingsNavigation() {
  const cls = "inline-flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800";
  const active = { className: "bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" };
  return <nav aria-label="Settings" className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 text-sm font-semibold dark:border-slate-800 md:flex-col md:border-b-0">
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings"><NavIcon name="integrations" />Integrations</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/api-keys"><NavIcon name="key" />API keys</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/authorized-clients"><NavIcon name="users" />Authorized clients</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/password"><NavIcon name="lock" />Change password</Link>
  </nav>;
}
export function SettingsLayout({ title, children }: { title: string; children: ReactNode }) { return <Page><div className="grid min-w-0 gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10"><SettingsNavigation /><div className="min-w-0"><h1>{title}</h1><p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{title === "Integrations" ? "Connect every provider used by your jobs. Stored credentials are write-only." : "Manage access to your software factory."}</p>{children}</div></div></Page>; }
