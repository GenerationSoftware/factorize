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
  return <><Button aria-label="Search jobs, runs, and messages" onClick={() => setOpen(true)}>Search (/)</Button>{open && <Suspense fallback={<p role="status">Loading search…</p>}><Dialog close={() => setOpen(false)} /></Suspense>}</>;
}
