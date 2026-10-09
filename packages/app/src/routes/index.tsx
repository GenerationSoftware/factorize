import { Link } from "@tanstack/react-router";

export function MigrationIndex() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-semibold">Factorize</h1>
      <p className="mt-4"><Link to="/auth/login">Sign in</Link> · <Link to="/auth/signup">Create an account</Link></p>
      <p className="mt-4"><Link to="/jobs" search={{ q: "" }}>Jobs</Link></p>
      <p className="mt-4">The static application is under development. Continue using the existing dashboard during the migration.</p>
    </main>
  );
}
