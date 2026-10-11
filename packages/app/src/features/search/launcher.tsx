import { Button } from "../../shared/ui";
import { lazy, Suspense, useEffect, useState } from "react";
const Dialog = lazy(() => import("./dialog"));
export function SearchLauncher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "/" || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  return <><Button aria-label="Search jobs, runs, and messages" title="Search (/)" className="!border-transparent !bg-transparent !px-2 text-slate-600 hover:!bg-stone-100 hover:text-slate-950 dark:text-slate-300 dark:hover:!bg-slate-800 dark:hover:text-white" onClick={() => setOpen(true)}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></svg>
    <span className="hidden sm:inline">Search</span><kbd className="hidden rounded border border-stone-300 px-1.5 py-0.5 text-[10px] font-normal sm:inline dark:border-slate-700">/</kbd>
  </Button>{open && <Suspense fallback={<p role="status">Loading search…</p>}><Dialog close={() => setOpen(false)} /></Suspense>}</>;
}
