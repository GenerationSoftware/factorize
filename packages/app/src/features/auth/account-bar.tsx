import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui";
import { SearchLauncher } from "../search/launcher";
import { ThemeToggle } from "../../shared/theme";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";
import { projectQuery, projectsQuery } from "../projects/queries";
import beeMark from "../../assets/bee-mark-monochrome.png";

export function AccountBar() {
  const session = useQuery(sessionQuery);
  const authenticated = session.data?.authenticated;
  const projects = useQuery({ ...projectsQuery, enabled: !!authenticated });
  const pathname = useRouterState({ select: state => state.location.pathname });
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const routeProjectId = match && match[1] !== "new" ? decodeURIComponent(match[1]) : undefined;
  const routeProject = useQuery({ ...projectQuery(routeProjectId ?? ""), enabled: !!authenticated && !!routeProjectId, retry: false });
  const currentProject = projects.data?.find(project => project.id === routeProjectId) ?? routeProject.data;
  const navigate = useNavigate();
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await api.POST("/api/v1/auth/logout");
      if (result.error) throw new Error(messageOf(result.error));
      await refreshIdentity();
    },
  });
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [active, setActive] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), searchInput = useRef<HTMLInputElement>(null), accountMenu = useRef<HTMLDivElement>(null), accountTrigger = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => (projects.data ?? []).filter(project => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [projects.data, search]);
  useEffect(() => {
    if (!open && !accountOpen) return;
    const click = (event: PointerEvent) => {
      if (open && !menu.current?.contains(event.target as Node)) setOpen(false);
      if (accountOpen && !accountMenu.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (open) { setOpen(false); trigger.current?.focus(); }
        if (accountOpen) { setAccountOpen(false); accountTrigger.current?.focus(); }
      }
    };
    document.addEventListener("pointerdown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key); };
  }, [open, accountOpen]);
  const choose = (id: string) => { setOpen(false); setSearch(""); void navigate({ to: "/projects/$projectId", params: { projectId: id } }); };
  const email = session.data?.authenticated ? session.data.user.email ?? "" : "";
  const initials = (email || "?").split("@")[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase() || "?";
  // The current session contract exposes email only. Use its local part as a readable
  // display identity and retain the full address in the account menu.
  const displayName = email.split("@")[0] || "Account";
  return <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-factorize-500 focus:p-3 focus:text-slate-950">Skip to content</a>
    <nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <Link to="/" aria-label="Factorize dashboard" className="flex shrink-0 items-center"><img src={beeMark} alt="" className="size-8 object-contain" /></Link>
        <span aria-hidden="true" className="h-8 w-px shrink-0 bg-stone-300 dark:bg-slate-700" />
        {authenticated ? <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Link to="/" title={session.data?.user.email} className="max-w-[38vw] truncate text-slate-700 hover:text-factorize-700 dark:text-slate-200 dark:hover:text-factorize-500 sm:max-w-56">{displayName}</Link>
          <span aria-hidden="true" className="text-slate-400">/</span>
          <div ref={menu} className="relative flex min-w-0 items-center">
          {currentProject ? <Link to="/projects/$projectId" params={{ projectId: currentProject.id }} className="max-w-[35vw] truncate text-slate-700 hover:text-factorize-700 dark:text-slate-200 sm:max-w-64">{currentProject.name}</Link> : routeProjectId ? <span className="truncate text-slate-600 dark:text-slate-300">{routeProject.isPending ? "Loading project…" : routeProject.error ? "Project unavailable" : "Project"}</span> : <Link to="/projects" className="truncate text-slate-600 hover:text-factorize-700 dark:text-slate-300 dark:hover:text-factorize-500">Projects</Link>}
            <button ref={trigger} type="button" aria-label="Switch project" aria-haspopup="listbox" aria-expanded={open} className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-factorize-500 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => { setOpen(value => !value); setSearch(""); setActive(0); requestAnimationFrame(() => searchInput.current?.focus()); }}><svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current"><path d="m5 7 5 5 5-5" /></svg></button>
            {open && <div className="absolute left-0 top-full z-40 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <label className="sr-only" htmlFor="project-switcher-search">Search projects</label>
              <input ref={searchInput} id="project-switcher-search" role="combobox" aria-autocomplete="list" aria-controls="project-switcher-options" aria-expanded="true" aria-activedescendant={options[active] ? `project-option-${options[active].id}` : undefined} value={search} onChange={event => { setSearch(event.target.value); setActive(0); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(index + 1, options.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); } else if (event.key === "Enter" && options[active]) { event.preventDefault(); choose(options[active].id); } }} placeholder="Search projects…" className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-factorize-500 focus:ring-2 focus:ring-factorize-500/30 dark:border-slate-700 dark:bg-slate-950" />
              <ul id="project-switcher-options" role="listbox" aria-label="Projects" className="mt-2 max-h-64 overflow-y-auto">
                {projects.isPending && <li role="status" className="px-3 py-2 text-sm text-slate-500">Loading projects…</li>}
                {projects.error && <li role="alert" className="px-3 py-2 text-sm text-red-700">{projects.error.message}</li>}
                {projects.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No projects yet.</li>}
                {projects.data && !projects.error && options.length === 0 && projects.data.length > 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching projects.</li>}
                {options.map((project, index) => <li key={project.id} id={`project-option-${project.id}`} role="option" aria-selected={project.id === routeProjectId} className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${index === active ? "bg-factorize-50 text-slate-950 dark:bg-slate-800 dark:text-white" : "text-slate-700 dark:text-slate-200"}`} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(project.id)}>{project.name}{project.id === routeProjectId && <span className="ml-2 text-xs text-slate-500">Current</span>}</li>)}
              </ul>
            </div>}
          </div>
        </div> : <Link to="/" className="text-sm font-semibold">Dashboard</Link>}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {authenticated && <SearchLauncher />}
        <ThemeToggle />
        {authenticated ? <div ref={accountMenu} className="relative">
          <Button ref={accountTrigger} aria-expanded={accountOpen} aria-controls="profile-menu" onClick={() => setAccountOpen(!accountOpen)} aria-label="Your account" className="!size-10 !min-h-10 !rounded-full !border-0 !bg-factorize-500 !p-0 text-sm font-semibold text-slate-950">{initials}</Button>
          {accountOpen && <div id="profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div> : <Link to="/auth/login" className="rounded-lg px-3 py-2 text-sm font-semibold">Account</Link>}
      </div>
    </nav>
    {logout.isError && <p role="alert">{logout.error.message}</p>}
  </header>;
}
