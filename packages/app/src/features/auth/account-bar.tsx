import { TeamNavigation } from "./team-navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui";
import { ThemeToggle } from "../../shared/theme";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";
import { triggerQuery, triggersQuery } from "../triggers/queries";
import { ResourceSwitcher } from "../../shared/resource-switcher";
import beeMark from "../../assets/bee-mark-monochrome.png";

export function AccountBar() {
  const session = useQuery(sessionQuery);
  const authenticated = session.data?.authenticated;
  const pathname = useRouterState({ select: state => state.location.pathname });
  const triggerMatch = pathname.match(/^\/triggers\/([^/]+)/);
  const routeTriggerId = triggerMatch && triggerMatch[1] !== "new" ? decodeURIComponent(triggerMatch[1]) : undefined;
  const currentTriggerId = routeTriggerId;
  const routeTrigger = useQuery({ ...triggerQuery(currentTriggerId ?? ""), enabled: !!authenticated && !!currentTriggerId, retry: false });
  const projectTriggers = useQuery({ ...triggersQuery(), enabled: !!authenticated && !!currentTriggerId });
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
  const accountMenu = useRef<HTMLDivElement>(null), accountEvent = useRef<HTMLButtonElement>(null), mobileAccountMenu = useRef<HTMLDivElement>(null), mobileAccountEvent = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const click = (event: PointerEvent) => { if (!accountMenu.current?.contains(event.target as Node) && !mobileAccountMenu.current?.contains(event.target as Node)) setAccountOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setAccountOpen(false); (mobileAccountOpen ? mobileAccountEvent : accountEvent).current?.focus(); } };
    document.addEventListener("pointerdown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key); };
  }, [accountOpen, mobileAccountOpen]);
  const chooseTrigger = (id: string) => { void navigate({ to: "/triggers/$triggerId", params: { triggerId: id } }); };
  const email = session.data?.authenticated ? session.data.user.email ?? "" : "";
  const initials = (email || "?").split("@")[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase() || "?";
  return <header className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-factorize-500 focus:p-3 focus:text-slate-950">Skip to content</a>
    <nav aria-label="Main navigation" className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link to="/" aria-label="Factorize dashboard" className="flex shrink-0 items-center">
          <img src={beeMark} alt="" className="size-8 object-contain dark:hidden" />
          <span aria-hidden="true" className="hidden size-8 bg-[#e5ad00] mask-contain mask-center mask-no-repeat dark:block" style={{ maskImage: `url(${beeMark})` }} />
        </Link>
        <span aria-hidden="true" className="hidden h-8 w-px shrink-0 bg-stone-300 dark:bg-slate-700" />
        {authenticated ? <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold sm:flex-initial">
          <Link to="/" title={session.data?.authenticated ? session.data.team.name ?? "Team" : "Team"} className="min-w-0 shrink-0 max-w-[24vw] truncate py-1 sm:max-w-56 hover:text-factorize-700 dark:hover:text-factorize-500">{session.data?.authenticated ? session.data.team.name ?? "Team" : "Team"}</Link>
          {currentTriggerId && <><span aria-hidden="true" className="hidden text-slate-400 sm:mr-1 sm:inline">/</span><div className="flex min-w-0 items-center">
            {routeTrigger.data ? <Link to="/triggers/$triggerId" params={{ triggerId: routeTrigger.data.id }} title={routeTrigger.data.name} className="min-w-0 max-w-[42vw] truncate rounded-md py-1 text-slate-700 transition-colors hover:bg-stone-100 hover:text-factorize-700 dark:text-slate-200 dark:hover:bg-slate-800 sm:max-w-56">{routeTrigger.data.name}</Link> : <span className="truncate text-slate-600 dark:text-slate-300">{routeTrigger.isPending ? "Loading trigger…" : routeTrigger.error ? "Trigger unavailable" : "Trigger"}</span>}
            <ResourceSwitcher compact kind="Trigger" items={(projectTriggers.data ?? []).map(trigger => ({ id: trigger.id, name: trigger.name }))} currentId={currentTriggerId} loading={projectTriggers.isPending} error={projectTriggers.error?.message} onSelect={chooseTrigger} />
          </div></>}
        </div> : <Link to="/" className="text-sm font-semibold">Dashboard</Link>}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <ThemeToggle />
        {authenticated && <div ref={mobileAccountMenu} className="relative sm:hidden">
          <Button ref={mobileAccountEvent} aria-expanded={accountOpen} aria-controls="mobile-profile-menu" onClick={() => { setMobileAccountOpen(true); setAccountOpen(!accountOpen); }} aria-label="Your account" className="!size-9 !min-h-9 !rounded-full !border-0 !bg-factorize-500 !p-0 text-xs font-semibold text-slate-950">{initials}</Button>
          {accountOpen && mobileAccountOpen && <div id="mobile-profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings/profile" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Account settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div>}
        {authenticated ? <div ref={accountMenu} className="relative hidden sm:block">
          <Button ref={accountEvent} aria-expanded={accountOpen} aria-controls="profile-menu" onClick={() => { setMobileAccountOpen(false); setAccountOpen(!accountOpen); }} aria-label="Your account" className="!size-10 !min-h-10 !rounded-full !border-0 !bg-factorize-500 !p-0 text-sm font-semibold text-slate-950">{initials}</Button>
          {accountOpen && <div id="profile-menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-3 break-all px-2 text-xs text-slate-600 dark:text-slate-300">{session.data?.user.email ?? ""}</p>
            <Link to="/settings/profile" onClick={() => setAccountOpen(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-stone-100 dark:hover:bg-slate-800">Account settings</Link>
            <Button className="mt-2 w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? "Signing out…" : "Sign out"}</Button>
          </div>}
        </div> : <Link to="/auth/login" className="rounded-lg px-3 py-2 text-sm font-semibold">Account</Link>}
      </div>
    </nav>
    {authenticated && (["/", "/triggers", "/events", "/integrations", "/workloads"].includes(pathname) || pathname === "/apps" || pathname.startsWith("/workloads/") || (pathname === "/clients" || pathname.startsWith("/clients/")) || pathname.startsWith("/settings/") || pathname === "/settings") && <TeamNavigation pathname={pathname}/>}
    {logout.isError && <p role="alert">{logout.error.message}</p>}
  </header>;
}
