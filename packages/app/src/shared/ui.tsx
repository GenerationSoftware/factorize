import { Children, type ComponentProps, type ReactNode } from "react";
export const buttonClasses = {
  primary: "bg-factorize-500 text-slate-950 border-factorize-500 hover:bg-factorize-100",
  secondary: "bg-white text-slate-700 border-stone-200 hover:bg-stone-100 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800",
  destructive: "bg-red-50 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
};
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
