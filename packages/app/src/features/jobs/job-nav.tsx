import { Link } from "@tanstack/react-router";

type JobTab = "runs" | "settings";

export function JobNav({ jobId, tab }: { jobId: string; tab: JobTab }) {
  const tabs = [
    { id: "runs" as const, label: "Runs", to: "/jobs/$jobId" as const },
    { id: "settings" as const, label: "Settings", to: "/jobs/$jobId/settings" as const },
  ];
  return <nav aria-label="Job navigation" className="border-y border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
      {tabs.map(item => <Link key={item.id} to={item.to} params={{ jobId }} className={`inline-flex min-h-12 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${tab === item.id ? "border-factorize-500 text-factorize-700 dark:text-factorize-500" : "border-transparent text-slate-600 hover:border-stone-300 hover:text-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"}`} aria-current={tab === item.id ? "page" : undefined}>{item.label}</Link>)}
    </div>
  </nav>;
}
