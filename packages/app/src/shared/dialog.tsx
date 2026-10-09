import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./ui";
/** Native modal semantics provide focus containment, Escape and focus restoration. */
export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} aria-label={title} onClose={close} className="w-[min(42rem,calc(100vw-2rem))]">
    <div className="mb-5 flex items-start justify-between gap-3"><h2>{title}</h2><Button onClick={close} aria-label={`Close ${title.toLowerCase()}`}>✕</Button></div>{children}
  </dialog>;
}
