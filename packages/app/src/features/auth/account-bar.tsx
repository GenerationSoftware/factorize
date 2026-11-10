import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui";
import { SearchLauncher } from "../search/launcher";
import { ThemeToggle } from "../../shared/theme";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";
import { projectsQuery } from "../projects/queries";
import { useNavigate } from "@tanstack/react-router";

export function AccountBar() {
  const session = useQuery(sessionQuery);
  const projects = useQuery({ ...projectsQuery, enabled: !!session.data?.authenticated });
  const navigate = useNavigate();
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await api.POST("/api/v1/auth/logout");
      if (result.error) throw new Error(messageOf(result.error));
      await refreshIdentity();
    },
  });
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  const authenticated = session.data?.authenticated;
  return <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-factorize-500 focus:p-3 focus:text-slate-950">Skip to content</a>
    <nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
      {authenticated ? <Link to="/" className="truncate text-sm font-semibold text-slate-700 hover:text-factorize-700 dark:text-slate-200 dark:hover:text-factorize-500" title={session.data?.user.email}>{session.data?.user.email}</Link> : <Link to="/" className="text-sm font-semibold">Dashboard</Link>}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        {authenticated && <><label className="sr-only" htmlFor="project-switcher">Project</label><input id="project-switcher" list="project-options" placeholder="Select project…" className="h-10 w-36 rounded-lg border border-stone-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 sm:w-52" onChange={event => { const project = projects.data?.find(item => item.name === event.currentTarget.value); if (project) void navigate({ to: "/projects/$projectId", params: { projectId: project.id } }); }} /><datalist id="project-options">{projects.data?.map(project => <option key={project.id} value={project.name} />)}</datalist><SearchLauncher /></>}
        <ThemeToggle />
        {authenticated ? <div ref={menu} className="relative">
          <Button ref={trigger} aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen(!open)} aria-label="Your account" className="!size-10 !min-h-10 !rounded-full !p-1"><span className="flex size-7 items-center justify-center rounded-full bg-factorize-100 text-xs font-semibold text-slate-950">{(session.data?.user.email ?? "").slice(0, 1).toUpperCase()}</span></Button>
          {open && <div id="profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div> : <Link to="/auth/login" className="rounded-lg px-3 py-2 text-sm font-semibold">Account</Link>}
      </div>
    </nav>
    {logout.isError && <p role="alert">{logout.error.message}</p>}
  </header>;
}
