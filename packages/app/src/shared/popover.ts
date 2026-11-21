import { useLayoutEffect, useRef, useState } from "react";

/** Top-layer panels escape cards/dialog clipping and stay inside the visual viewport. */
export function usePopover({ align = "start", width = 288 }: { align?: "start" | "end"; width?: number | "anchor" } = {}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement>(null), panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !panel.current || !anchor.current) return;
    const element = panel.current, viewport = window.visualViewport;
    element.showPopover();
    const position = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight);
      const panelWidth = Math.min(width === "anchor" ? rect.width : width, right - left - 24);
      element.style.width = `${panelWidth}px`;
      const below = bottom - rect.bottom - 16, above = rect.top - top - 16;
      const flip = below < Math.min(element.scrollHeight, 256) && above > below;
      element.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
      element.style.left = `${Math.max(left + 12, Math.min(align === "end" ? rect.right - panelWidth : rect.left, right - panelWidth - 12))}px`;
      element.style.top = `${flip ? Math.max(top + 12, rect.top - element.getBoundingClientRect().height - 4) : rect.bottom + 4}px`;
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(element); observer.observe(anchor.current);
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); anchor.current?.focus(); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    viewport?.addEventListener("resize", position); viewport?.addEventListener("scroll", position);
    return () => {
      element.hidePopover(); observer.disconnect();
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position); viewport?.removeEventListener("scroll", position);
    };
  }, [open, align, width]);
  return { open, setOpen, anchor, panel, close: () => { setOpen(false); anchor.current?.focus(); } };
}

export const popoverClasses = "fixed m-0 overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white p-1 text-slate-950 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
export const menuItemClasses = "flex min-h-11 w-full items-center rounded px-3 py-2 text-left text-sm hover:bg-stone-100 focus:bg-stone-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
