import { Card, Page } from "../shared/ui";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "../features/auth/session";
export function MigrationIndex() {
  const session = useQuery(sessionQuery);
  return <Page className="mx-auto max-w-3xl p-6"><Card className="mx-auto my-8 max-w-xl"><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-factorize-700 dark:text-factorize-500">Your software factory</p><h1>Welcome to Factorize</h1><p className="mb-6 text-slate-600 dark:text-slate-400">Connect your tools, configure your jobs, and follow every run.</p>
    {session.isPending && <p role="status">Loading your account…</p>}{session.error && <p role="alert">{session.error.message}</p>}
    {session.data?.authenticated ? <p className="mt-4"><Link to="/jobs" search={{ q: "" }}>Jobs</Link> · <Link to="/settings">Settings</Link></p> : <p className="mt-4"><Link to="/auth/login">Sign in</Link> · <Link to="/auth/signup">Create an account</Link></p>}
    <p className="mt-4"><a href="https://factorize.sh">About Factorize</a></p>
  </Card></Page>;
}
