import { Badge, Card, Page, RunStatusDot } from "../shared/ui";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "../features/auth/session";
import { recentTriggersQuery } from "../features/jobs/queries";
import { runPageQuery } from "../features/runs/queries";
import type { ReactNode } from "react";

const timestamp = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
function RecentSection({ title, children, empty }: { title: string; children: ReactNode; empty: string }) {
  return <Card><h2 className="text-lg font-semibold">{title}</h2>{children || <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{empty}</p>}</Card>;
}
function RecentDashboard() {
  const triggers = useQuery(recentTriggersQuery), runs = useQuery(runPageQuery({ limit: 5 }));
  const error = triggers.error || runs.error;
  return <Page><div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-factorize-700 dark:text-factorize-500">Your software factory</p><h1>Recent work</h1><p className="mt-2 text-slate-600 dark:text-slate-400">Pick up where you left off.</p></div>{error && <p className="mb-6" role="alert">{error.message}</p>}<div className="grid gap-5 lg:grid-cols-2"><RecentSection title="Recent triggers" empty="Triggers you update will appear here.">{triggers.data?.items.length ? <ul className="mt-4 divide-y divide-stone-200 dark:divide-slate-800">{triggers.data.items.map(trigger => <li key={trigger.id} className="py-3 first:pt-0 last:pb-0"><Link preload="intent" to="/triggers/$triggerId" params={{ triggerId: trigger.id }} className="block rounded-md hover:text-factorize-700"><span className="font-semibold">{trigger.name}</span><span className="mt-1 block text-xs text-slate-500">{trigger.lastRunState ? <><RunStatusDot state={trigger.lastRunState} decorative /> <span className="ml-1">{trigger.lastRunState}</span> · </> : "No runs · "}Updated {timestamp(trigger.updatedAt)}</span></Link></li>)}</ul> : null}</RecentSection><RecentSection title="Recent runs" empty="Runs from your triggers will appear here.">{runs.data?.items.length ? <ul className="mt-4 divide-y divide-stone-200 dark:divide-slate-800">{runs.data.items.map(run => <li key={run.id} className="py-3 first:pt-0 last:pb-0"><Link to="/runs/$runId" params={{ runId: run.id }} className="block rounded-md hover:text-factorize-700"><span className="font-semibold">{run.run_name || "Unnamed run"}</span><span className="mt-1 block text-xs text-slate-500"><Badge>{run.state}</Badge><span className="ml-2">{run.trigger_name} · {timestamp(run.created_at)}</span></span></Link></li>)}</ul> : null}</RecentSection></div></Page>;
}
export function MigrationIndex() {
  const session = useQuery(sessionQuery);
  if (session.data?.authenticated) return <RecentDashboard />;
  return <Page className="mx-auto max-w-3xl p-6"><Card className="mx-auto my-8 max-w-xl"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-factorize-700 dark:text-factorize-500">Your software factory</p><h1>Welcome to Factorize</h1><p className="mb-6 text-slate-600 dark:text-slate-400">Connect your tools, configure your triggers, and follow every run.</p>
    {session.isPending && <p role="status">Loading your account…</p>}{session.error && <p role="alert">{session.error.message}</p>}
    <p className="mt-4"><Link to="/auth/login">Sign in</Link> · <Link to="/auth/signup">Create an account</Link></p>
    <p className="mt-4"><a href="https://factorize.sh">About Factorize</a></p>
  </Card></Page>;
}
