import { Children, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
export const buttonClasses = {
  primary: "bg-factorize-500 text-slate-950 border-factorize-500 hover:bg-factorize-100",
  secondary: "bg-white text-slate-700 border-stone-200 hover:bg-stone-100 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800",
  destructive: "bg-red-50 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
};
export const tableShellClasses = "overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
export const tableClasses = "w-full text-left text-sm";
export const tableHeadClasses = "bg-stone-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400";
export const tableRowClasses = "group relative border-t border-stone-200 transition-colors hover:bg-factorize-50 focus-within:bg-factorize-50 focus-within:shadow-[inset_3px_0_0_var(--color-factorize-500)] dark:border-slate-800 dark:hover:bg-factorize-500/10 dark:focus-within:bg-factorize-500/10";
export const tableCellClasses = "px-2 py-2 sm:px-3";
export function Table({ className = "", children, shellProps, ...props }: ComponentProps<"table"> & { shellProps?: ComponentProps<"div"> }) {
  return <div {...shellProps} className={`${tableShellClasses} ${shellProps?.className ?? ""}`}><table {...props} className={`${tableClasses} ${className}`}>{children}</table></div>;
}
export function SortableHeader({ label, active = false, direction = "asc", onSort, className = "", ariaLabel = label }: { label: string; active?: boolean; direction?: "asc" | "desc"; onSort: () => void; className?: string; ariaLabel?: string }) {
  const order = active ? (direction === "desc" ? "descending" : "ascending") : "none";
  const next = active && direction === "asc" ? "descending" : "ascending";
  return <th scope="col" aria-sort={order} className={`${tableCellClasses} ${className}`}><button type="button" className="font-semibold underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:decoration-current focus-visible:outline-none" onClick={onSort} aria-label={`${ariaLabel}, ${active ? `sorted ${order}` : "not sorted"}. Activate to sort ${next}`}>{label}{active && <span aria-hidden="true"> {direction === "desc" ? "↓" : "↑"}</span>}</button></th>;
}
export const runStatuses = ["queued", "starting", "running", "blocked", "stopping", "succeeded", "failed", "stopped", "ignored", "done"] as const;
export type RunStatus = typeof runStatuses[number];
const runStatusLabels: Record<RunStatus, string> = { queued: "Queued", starting: "Starting", running: "Running", blocked: "Blocked", stopping: "Stopping", succeeded: "Succeeded", failed: "Failed", stopped: "Stopped", ignored: "Ignored", done: "Done" };
export function StatusHeader({ selected, sortDirection, onFilterChange, onSortChange, onClear }: { selected: RunStatus[]; sortDirection?: "asc" | "desc"; onFilterChange: (status: RunStatus, checked: boolean) => void; onSortChange: (direction?: "asc" | "desc") => void; onClear: () => void }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null), buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    const onClick = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);
  const filterSummary = selected.length ? `${selected.length} status${selected.length === 1 ? "" : "es"} selected` : "all statuses";
  return <th scope="col" aria-sort={sortDirection ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className={tableCellClasses}>
    <div ref={ref} className="relative"><button ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Status, ${filterSummary}${sortDirection ? `, sorted ${sortDirection}` : ", not sorted"}`} className="font-semibold underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:rounded-sm focus-visible:decoration-current focus-visible:outline-none" onClick={() => setOpen(value => !value)}>Status{selected.length > 0 && <span aria-hidden="true"> ({selected.length})</span>}{sortDirection && <span aria-hidden="true"> {sortDirection === "asc" ? "↑" : "↓"}</span>}</button>
      {open && <div role="dialog" aria-label="Status filter and sort" className="absolute left-0 z-20 mt-2 w-64 rounded-lg border border-stone-300 bg-white p-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"><fieldset><legend className="font-semibold">Filter statuses</legend>{runStatuses.map(status => <label key={status} className="flex min-h-10 items-center gap-2 py-1"><input type="checkbox" checked={selected.includes(status)} onChange={event => onFilterChange(status, event.target.checked)} />{runStatusLabels[status]}</label>)}</fieldset><div className="mt-2 border-t border-stone-200 pt-2 dark:border-slate-700"><span className="font-semibold">Sort status</span><div className="mt-1 flex gap-2"><button type="button" className="min-h-10 rounded border px-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2" aria-pressed={sortDirection === "asc"} onClick={() => onSortChange("asc")}>Ascending</button><button type="button" className="min-h-10 rounded border px-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2" aria-pressed={sortDirection === "desc"} onClick={() => onSortChange("desc")}>Descending</button></div></div><button type="button" className="mt-2 min-h-10 text-left font-semibold underline underline-offset-4" onClick={onClear}>Clear filters and reset sort</button></div>}
    </div></th>;
}
const runStatusStyles: Record<string, { label: string; color: string; pulse?: boolean }> = {
  queued: { label: "Queued", color: "bg-amber-500" }, starting: { label: "Starting", color: "bg-blue-500" }, running: { label: "Running", color: "bg-blue-500", pulse: true },
  blocked: { label: "Blocked", color: "bg-amber-500" }, stopping: { label: "Stopping", color: "bg-amber-500" }, succeeded: { label: "Succeeded", color: "bg-emerald-500" }, done: { label: "Done", color: "bg-emerald-500" },
  failed: { label: "Failed", color: "bg-red-500" }, stopped: { label: "Stopped", color: "bg-slate-500" }, ignored: { label: "Ignored", color: "bg-slate-400" },
};
export function RunStatusDot({ state }: { state: string }) {
  const status = runStatusStyles[state] ?? { label: state || "Unknown", color: "bg-slate-400" };
  return <span role="img" aria-label={`Status: ${status.label}`} title={status.label} className={`inline-block size-2.5 rounded-full ${status.color} ${status.pulse ? "motion-safe:animate-pulse" : ""}`} />;
}
export function Button({ variant = "secondary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonClasses }) {
  return <button {...props} className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonClasses[variant]} ${className}`} />;
}
export const fieldClasses = "mt-1.5 block w-full min-w-0 max-w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-slate-950 placeholder:text-slate-500 focus:border-factorize-500 focus:ring-3 focus:ring-factorize-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 disabled:opacity-50";
export function Input({ className = "", type, ...props }: ComponentProps<"input">) {
  return <input {...props} type={type} className={`${type === "checkbox" || type === "radio" ? "mr-2 size-4 accent-factorize-600 dark:accent-factorize-500" : fieldClasses} ${className}`} />;
}
export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) { return <textarea {...props} className={`${fieldClasses} min-h-28 font-mono leading-6 ${className}`} />; }
export function Select({ className = "", ...props }: ComponentProps<"select">) { return <select {...props} className={`${fieldClasses} ${className}`} />; }
export function Label({ className = "", ...props }: ComponentProps<"label">) { return <label {...props} className={`block min-w-0 text-sm font-medium text-slate-700 dark:text-slate-300 ${className}`} />; }
export function Page({ className = "", ...props }: ComponentProps<"main">) { return <main {...props} id="main-content" className={`mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8 ${className}`} />; }
export function Card({ className = "", ...props }: ComponentProps<"section">) { return <section {...props} className={`min-w-0 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6 ${className}`} />; }
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="mb-8 flex min-w-0 flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-3xl font-bold tracking-tight">{title}</h1>{description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{description}</p>}</div>{children}</div>;
}
export function Badge({ children, active = false }: { children: ReactNode; active?: boolean }) {
  const state = typeof children === "string" ? children : "";
  const classes = state === "failed" || state === "stopped"
    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    : state === "succeeded"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : active
    ? "border-factorize-500/40 bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500"
    : "border-stone-200 bg-stone-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>{children}</span>;
}
export function Disclosure({ className = "", children, ...props }: ComponentProps<"details">) {
  const [summary, ...content] = Children.toArray(children);
  return <details {...props} className={`my-3 min-w-0 rounded-lg border border-stone-200 dark:border-slate-700 ${className}`}>{summary}{content.length > 0 && <div className="mx-3 mb-3 min-w-0">{content}</div>}</details>;
}
export function Summary({ className = "", ...props }: ComponentProps<"summary">) {
  return <summary {...props} className={`cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-slate-800 ${className}`} />;
}
