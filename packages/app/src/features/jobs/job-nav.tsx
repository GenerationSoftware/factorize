import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";

type TriggerTab = "runs" | "settings";

export function TriggerNav({ triggerId, tab }: { triggerId: string; tab: TriggerTab }) {
  const tabs = [
    { id: "runs" as const, label: "Runs", to: "/triggers/$triggerId" as const, icon: <NavIcon name="runs" /> },
    { id: "settings" as const, label: "Settings", to: "/triggers/$triggerId/settings" as const, icon: <NavIcon name="settings" /> },
  ];
  return <nav aria-label="Trigger navigation" className="border-y border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
      {tabs.map(item => <Link key={item.id} to={item.to} params={{ triggerId }} className={`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${tab === item.id ? "border-factorize-500 text-factorize-700 dark:text-factorize-500" : "border-transparent text-slate-600 hover:border-stone-300 hover:text-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"}`} aria-current={tab === item.id ? "page" : undefined}>{item.icon}{item.label}</Link>)}
    </div>
  </nav>;
}
