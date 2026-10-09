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
  return <><button aria-label="Search jobs and runs" onClick={() => setOpen(true)}>Search (/)</button>{open && <Suspense fallback={<p role="status">Loading search…</p>}><Dialog close={() => setOpen(false)} /></Suspense>}</>;
}
