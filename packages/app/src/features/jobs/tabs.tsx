import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";

export function TriggerTabs({ triggerId }: { triggerId: string }) {
  const classes = "inline-flex min-h-11 items-center border-b-2 px-4 py-2 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-slate-800";
  const activeProps = { className: "border-factorize-500 text-factorize-700 dark:text-factorize-500", "aria-current": "page" as const };
  return <nav aria-label="Trigger views" className="mt-5 flex gap-2 border-b border-stone-200 dark:border-slate-700">
    <Link to="/triggers/$triggerId" params={{ triggerId }} search={{}} activeOptions={{ exact: true, includeSearch: false }} className={`${classes} gap-2`} activeProps={activeProps} inactiveProps={{ className: "border-transparent" }}><NavIcon name="runs" />Runs</Link>
    <Link to="/triggers/$triggerId/settings" params={{ triggerId }} activeOptions={{ exact: true, includeSearch: false }} className={`${classes} gap-2`} activeProps={activeProps} inactiveProps={{ className: "border-transparent" }}><NavIcon name="settings" />Settings</Link>
  </nav>;
}
