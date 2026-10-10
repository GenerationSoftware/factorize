import { Link } from "@tanstack/react-router";

export function JobTabs({ jobId }: { jobId: string }) {
  const classes = "inline-flex min-h-11 items-center border-b-2 px-4 py-2 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-slate-800";
  const activeProps = { className: "border-factorize-500 text-factorize-700 dark:text-factorize-500", "aria-current": "page" as const };
  return <nav aria-label="Job views" className="my-5 flex gap-2 border-b border-stone-200 dark:border-slate-700">
    <Link to="/jobs/$jobId" params={{ jobId }} search={{}} activeOptions={{ exact: true, includeSearch: false }} className={classes} activeProps={activeProps} inactiveProps={{ className: "border-transparent" }}>Runs</Link>
    <Link to="/jobs/$jobId/settings" params={{ jobId }} activeOptions={{ exact: true, includeSearch: false }} className={classes} activeProps={activeProps} inactiveProps={{ className: "border-transparent" }}>Settings</Link>
  </nav>;
}
