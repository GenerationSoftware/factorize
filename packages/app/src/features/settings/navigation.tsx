import type { ReactNode } from "react";
import { Page } from "../../shared/ui";
import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";

const linkClass = "inline-flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800";
const activeLink = { className: "bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" };

function SettingsSidebar({ label, children }: { label: string; children: ReactNode }) {
  return <nav aria-label={label} className="flex flex-wrap gap-2 border-b border-stone-200 pb-4 text-sm font-semibold dark:border-slate-800 md:flex-col md:border-b-0">{children}</nav>;
}

function SettingsFrame({ title, description, children, navigation }: { title: string; description?: string; children: ReactNode; navigation: ReactNode }) {
  return <Page><div className="grid min-w-0 gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
    {navigation}
    <div className="min-w-0">
      <h1 className={description ? undefined : "mb-6"}>{title}</h1>
      {description && <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{description}</p>}
      {children}
    </div>
  </div></Page>;
}

export function SettingsLayout({ title, children }: { title: string; children: ReactNode }) {
  return <SettingsFrame title={title} description="Manage access to your software factory." navigation={<SettingsSidebar label="Settings">
    <Link className={linkClass} activeProps={activeLink} to="/settings/permissions"><NavIcon name="key" />Permissions</Link>
    <Link className={linkClass} activeProps={activeLink} to="/settings/apps"><NavIcon name="integrations" />Registered apps</Link>
    <Link className={linkClass} activeProps={activeLink} to="/integrations"><NavIcon name="integrations" />Integrations</Link>
  </SettingsSidebar>}>{children}</SettingsFrame>;
}

export function AccountSettingsLayout({ title, children }: { title: string; children: ReactNode }) {
  return <SettingsFrame title={title} navigation={<SettingsSidebar label="Account settings">
    <Link className={linkClass} activeProps={activeLink} to="/settings/profile"><NavIcon name="users" />Profile</Link>
    <Link className={linkClass} activeProps={activeLink} to="/settings/api-keys"><NavIcon name="key" />API keys</Link>
    <Link className={linkClass} activeProps={activeLink} to="/settings/password"><NavIcon name="lock" />Change password</Link>
  </SettingsSidebar>}>{children}</SettingsFrame>;
}
