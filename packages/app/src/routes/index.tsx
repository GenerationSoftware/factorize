import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, Page } from "../shared/ui";
import { sessionQuery } from "../features/auth/session";
import { recentTriggersQuery } from "../features/triggers/queries";
function RecentDashboard() {
  const triggers = useQuery(recentTriggersQuery);
  return <Page><header className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-factorize-700">Your software factory</p><h1>Recent work</h1><p className="mt-2 text-slate-600 dark:text-slate-400">Manage Triggers and inspect the Events they publish.</p></header>{triggers.error && <p className="mb-6" role="alert">{triggers.error.message}</p>}<Card><h2 className="text-lg font-semibold">Recent Triggers</h2>{triggers.data?.items.length ? <ul className="mt-4 divide-y divide-stone-200 dark:divide-slate-800">{triggers.data.items.map(trigger => <li key={trigger.id} className="py-3"><Link preload="intent" to="/triggers/$triggerId" params={{ triggerId: trigger.id }} className="block rounded-md hover:text-factorize-700"><span className="font-semibold">{trigger.name}</span><span className="mt-1 block text-xs text-slate-500">Updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(trigger.updatedAt))}</span></Link></li>)}</ul> : <p className="mt-4 text-sm text-slate-600">Triggers you update will appear here.</p>}<Link className="mt-4 inline-block" to="/events">Browse Events</Link></Card></Page>;
}
export function MigrationIndex() {
  const session = useQuery(sessionQuery);
  if (session.data?.authenticated) return <RecentDashboard />;
  return <Page className="mx-auto max-w-3xl p-6"><Card className="mx-auto my-8 max-w-xl"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-factorize-700">Your software factory</p><h1>Welcome to Factorize</h1><p className="mb-6 text-slate-600 dark:text-slate-400">Connect your tools, configure Triggers, and publish Events.</p>{session.isPending && <p role="status">Loading your account…</p>}{session.error && <p role="alert">{session.error.message}</p>}<p className="mt-4"><Link to="/auth/login">Sign in</Link> · <Link to="/auth/signup">Create an account</Link></p><p className="mt-4"><a href="https://factorize.sh">About Factorize</a></p></Card></Page>;
}
