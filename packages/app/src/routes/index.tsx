import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "../features/auth/session";
export function MigrationIndex() {
  const session = useQuery(sessionQuery);
  return <main className="mx-auto max-w-3xl p-6"><h1 className="text-3xl font-semibold">Factorize</h1>
    {session.isPending && <p role="status">Loading your account…</p>}{session.error && <p role="alert">{session.error.message}</p>}
    {session.data?.authenticated ? <p className="mt-4"><Link to="/jobs" search={{ q: "" }}>Jobs</Link> · <Link to="/settings">Settings</Link></p> : <p className="mt-4"><Link to="/auth/login">Sign in</Link> · <Link to="/auth/signup">Create an account</Link></p>}
    <p className="mt-4"><a href="https://factorize.sh">About Factorize</a></p>
  </main>;
}
