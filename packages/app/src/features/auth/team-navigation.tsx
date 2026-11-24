import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";
export const tabClasses=(active:boolean)=>`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${active?"border-factorize-500 text-factorize-700 dark:text-factorize-500":"border-transparent text-slate-600 hover:border-stone-300 dark:text-slate-300"}`;

const tabs = [
  ["/clients", "users", "Clients"],
  ["/workloads", "key", "Workloads"],
  ["/apps", "integrations", "Apps"],
  ["/events", "integrations", "Events"],
  ["/settings/permissions", "settings", "Settings"],
] as const;

export function TeamNavigation({ pathname }: { pathname: string }) {
  const matches = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const inSettings = pathname === "/settings" || matches("/settings/apps") || matches("/integrations");

  return <nav aria-label="Dashboard navigation" className="border-t border-stone-200 dark:border-slate-800">
    <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
      {tabs.map(([to, icon, label]) => {
        const active = matches(to) || (to === "/settings/permissions" && inSettings);
        return <Link key={to} to={to} className={tabClasses(active)} aria-current={active ? "page" : undefined}>
          <NavIcon name={icon} />{label}
        </Link>;
      })}
    </div>
  </nav>;
}
