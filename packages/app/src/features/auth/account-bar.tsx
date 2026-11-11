import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui";
import { SearchLauncher } from "../search/launcher";
import { ThemeToggle } from "../../shared/theme";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";
import { projectQuery, projectsQuery } from "../projects/queries";
import { jobQuery, jobsQuery } from "../jobs/queries";
import { runStatusQuery } from "../runs/queries";
import { ResourceSwitcher } from "../../shared/resource-switcher";
import beeMark from "../../assets/bee-mark-monochrome.png";

export function AccountBar() {
  const session = useQuery(sessionQuery);
  const authenticated = session.data?.authenticated;
  const projects = useQuery({ ...projectsQuery, enabled: !!authenticated });
  const pathname = useRouterState({ select: state => state.location.pathname });
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const routeProjectId = projectMatch && projectMatch[1] !== "new" ? decodeURIComponent(projectMatch[1]) : undefined;
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)/);
  const routeJobId = jobMatch && jobMatch[1] !== "new" ? decodeURIComponent(jobMatch[1]) : undefined;
  const runMatch = pathname.match(/^\/job-runs\/([^/]+)/);
  const routeRunId = runMatch && runMatch[1] !== "new" ? decodeURIComponent(runMatch[1]) : undefined;
  const routeRun = useQuery({ ...runStatusQuery(routeRunId ?? ""), enabled: !!authenticated && !!routeRunId });
  const currentJobId = routeJobId ?? routeRun.data?.job_id;
  const routeJob = useQuery({ ...jobQuery(currentJobId ?? ""), enabled: !!authenticated && !!currentJobId, retry: false });
  const currentProjectId = routeProjectId ?? routeJob.data?.projectId;
  const routeProject = useQuery({ ...projectQuery(currentProjectId ?? ""), enabled: !!authenticated && !!currentProjectId, retry: false });
  const currentProject = projects.data?.find(project => project.id === currentProjectId) ?? routeProject.data;
  const projectJobs = useQuery({ ...jobsQuery({ projectId: currentProjectId, sort: "title" }), enabled: !!authenticated && !!currentJobId && !!currentProjectId });
  const navigate = useNavigate();
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await api.POST("/api/v1/auth/logout");
      if (result.error) throw new Error(messageOf(result.error));
      await refreshIdentity();
    },
  });
  const [accountOpen, setAccountOpen] = useState(false), [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const accountMenu = useRef<HTMLDivElement>(null), accountTrigger = useRef<HTMLButtonElement>(null), mobileAccountMenu = useRef<HTMLDivElement>(null), mobileAccountTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const click = (event: PointerEvent) => { if (!accountMenu.current?.contains(event.target as Node) && !mobileAccountMenu.current?.contains(event.target as Node)) setAccountOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setAccountOpen(false); (mobileAccountOpen ? mobileAccountTrigger : accountTrigger).current?.focus(); } };
    document.addEventListener("pointerdown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key); };
  }, [accountOpen, mobileAccountOpen]);
  const chooseProject = (id: string) => { void navigate({ to: "/projects/$projectId", params: { projectId: id } }); };
  const chooseJob = (id: string) => { void navigate({ to: "/jobs/$jobId", params: { jobId: id } }); };
  const email = session.data?.authenticated ? session.data.user.email ?? "" : "";
  const initials = (email || "?").split("@")[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase() || "?";
  return <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-factorize-500 focus:p-3 focus:text-slate-950">Skip to content</a>
    <nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <Link to="/" aria-label="Factorize dashboard" className="flex shrink-0 items-center"><img src={beeMark} alt="" className="size-8 object-contain" /></Link>
        <span aria-hidden="true" className="hidden h-8 w-px shrink-0 bg-stone-300 dark:bg-slate-700" />
        {authenticated ? <div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold sm:flex-initial sm:gap-2">
          {currentProjectId && <><span aria-hidden="true" className="hidden text-slate-400 sm:inline">/</span><div className="flex min-w-0 items-center">
            {currentProject ? <Link to="/projects/$projectId" params={{ projectId: currentProject.id }} title={currentProject.name} className="min-w-0 max-w-[55vw] truncate text-slate-700 hover:text-factorize-700 dark:text-slate-200 sm:max-w-64">{currentProject.name}</Link> : <span className="truncate text-slate-600 dark:text-slate-300">{routeProject.isPending ? "Loading project…" : routeProject.error ? "Project unavailable" : "Project"}</span>}
            <ResourceSwitcher kind="Project" items={projects.data ?? []} currentId={currentProjectId} loading={projects.isPending} error={projects.error?.message} onSelect={chooseProject} />
          </div></>}
          {currentJobId && <><span aria-hidden="true" className="hidden text-slate-400 sm:inline">/</span><div className="flex min-w-0 items-center">
            {routeJob.data ? <Link to="/jobs/$jobId" params={{ jobId: routeJob.data.id }} title={routeJob.data.name} className="min-w-0 max-w-[42vw] truncate text-slate-700 hover:text-factorize-700 dark:text-slate-200 sm:max-w-56">{routeJob.data.name}</Link> : <span className="truncate text-slate-600 dark:text-slate-300">{routeJob.isPending ? "Loading job…" : routeJob.error ? "Job unavailable" : "Job"}</span>}
            <ResourceSwitcher kind="Job" items={(projectJobs.data?.items ?? []).map(job => ({ id: job.id, name: job.name }))} currentId={currentJobId} loading={projectJobs.isPending} error={projectJobs.error?.message} onSelect={chooseJob} />
          </div></>}
        </div> : <Link to="/" className="text-sm font-semibold">Dashboard</Link>}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {authenticated && <SearchLauncher />}
        <ThemeToggle />
        {authenticated && <div ref={mobileAccountMenu} className="relative sm:hidden">
          <Button ref={mobileAccountTrigger} aria-expanded={accountOpen} aria-controls="mobile-profile-menu" onClick={() => { setMobileAccountOpen(true); setAccountOpen(!accountOpen); }} aria-label="Your account" className="!size-9 !min-h-9 !rounded-full !border-0 !bg-factorize-500 !p-0 text-xs font-semibold text-slate-950">{initials}</Button>
          {accountOpen && mobileAccountOpen && <div id="mobile-profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div>}
        {authenticated ? <div ref={accountMenu} className="relative hidden sm:block">
          <Button ref={accountTrigger} aria-expanded={accountOpen} aria-controls="profile-menu" onClick={() => { setMobileAccountOpen(false); setAccountOpen(!accountOpen); }} aria-label="Your account" className="!size-10 !min-h-10 !rounded-full !border-0 !bg-factorize-500 !p-0 text-sm font-semibold text-slate-950">{initials}</Button>
          {accountOpen && <div id="profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div> : <Link to="/auth/login" className="rounded-lg px-3 py-2 text-sm font-semibold">Account</Link>}
      </div>
    </nav>
    {authenticated && (pathname === "/" || pathname === "/projects") && <nav aria-label="Dashboard navigation" className="border-t border-stone-200 dark:border-slate-800">
      <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        <Link to="/projects" className={`inline-flex min-h-12 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${pathname === "/projects" ? "border-factorize-500 text-factorize-700 dark:text-factorize-500" : "border-transparent text-slate-600 hover:border-stone-300 hover:text-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"}`} aria-current={pathname === "/projects" ? "page" : undefined}>Projects</Link>
      </div>
    </nav>}
    {logout.isError && <p role="alert">{logout.error.message}</p>}
  </header>;
}
