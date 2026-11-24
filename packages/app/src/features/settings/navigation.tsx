import type { ReactNode } from "react";
import { Page } from "../../shared/ui";
import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";
export function SettingsSidebar({ label, children }: { label: string; children: ReactNode }) {
  return <nav aria-label={label} className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 text-sm font-semibold dark:border-slate-800 md:flex-col md:border-b-0">{children}</nav>;
}
export function SettingsNavigation() {
  const cls = "inline-flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800";
  const active = { className: "bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" };
  return <SettingsSidebar label="Settings">
    <Link className={cls} activeProps={active} to="/settings/permissions"><NavIcon name="key" />Permissions</Link>
    <Link className={cls} activeProps={active} to="/apps"><NavIcon name="integrations" />Apps</Link>
    <Link className={cls} activeProps={active} to="/integrations"><NavIcon name="integrations" />Integrations</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/profile"><NavIcon name="users" />Profile</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/api-keys"><NavIcon name="key" />API keys</Link>
    <Link className={cls} activeOptions={{ exact: true }} activeProps={active} to="/settings/password"><NavIcon name="lock" />Change password</Link>
  </SettingsSidebar>;
}
export function SettingsFrame({ title, children, navigation }: { title: string; children: ReactNode; navigation: ReactNode }) { return <Page><div className="grid min-w-0 gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">{navigation}<div className="min-w-0"><h1>{title}</h1><p className="mb-6 text-sm text-slate-600 dark:text-slate-400">Manage access to your software factory.</p>{children}</div></div></Page>; }

export function SettingsLayout({title,children}:{title:string;children:ReactNode}) { return <SettingsFrame title={title} navigation={<SettingsNavigation />}>{children}</SettingsFrame>; }
