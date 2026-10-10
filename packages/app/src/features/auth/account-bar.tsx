import beeMark from "../../assets/bee-mark-monochrome.png";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui";
import { SearchLauncher } from "../search/launcher";
import { ThemeToggle } from "../../shared/theme";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity, sessionQuery } from "./session";

export function AccountBar() {
  const session = useQuery(sessionQuery);
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
      <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight"><img src={beeMark} alt="" className="size-8 object-contain dark:invert" />Factorize</Link>
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        {authenticated && <><Link to="/jobs" search={{ q: "" }} activeProps={{ className: "text-factorize-700 dark:text-factorize-500" }} className="rounded-lg px-2 py-2 text-sm font-semibold">Jobs</Link><Link to="/job-runs" activeProps={{ className: "text-factorize-700 dark:text-factorize-500" }} className="rounded-lg px-2 py-2 text-sm font-semibold">Runs</Link><SearchLauncher /></>}
        <ThemeToggle />
        {authenticated ? <div ref={menu} className="relative">
          <Button ref={trigger} aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen(!open)} aria-label="Your account"><span className="flex size-6 items-center justify-center rounded-full bg-factorize-100 text-xs text-slate-950">{(session.data?.user.email ?? "").slice(0, 1).toUpperCase()}</span><span className="hidden sm:inline">Account</span><span aria-hidden="true">⌄</span></Button>
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
