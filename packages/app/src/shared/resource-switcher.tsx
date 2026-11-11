import { useEffect, useMemo, useRef, useState } from "react";

export type ResourceSwitcherItem = { id: string; name: string };

/** A compact, keyboard accessible filterable switcher shared by resource navigation. */
export function ResourceSwitcher({
  kind, items, currentId, loading, error, onSelect,
}: {
  kind: string;
  items: ResourceSwitcherItem[];
  currentId: string;
  loading?: boolean;
  error?: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(() => items.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [items, search]);
  const listId = `${kind.toLocaleLowerCase()}-switcher-options`;

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [open]);

  const select = (id: string) => { setOpen(false); setSearch(""); onSelect(id); };
  return <div ref={root} className="relative flex min-w-0 items-center">
    <button ref={trigger} type="button" aria-label={`Switch ${kind.toLocaleLowerCase()}`} aria-haspopup="listbox" aria-expanded={open}
      className="ml-0 flex size-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-factorize-500 dark:text-slate-300 dark:hover:bg-slate-800 sm:ml-1"
      onClick={() => { setOpen(value => !value); setSearch(""); setActive(0); requestAnimationFrame(() => input.current?.focus()); }}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current"><path d="m5 7 5 5 5-5" /></svg>
    </button>
    {open && <div className="absolute left-0 top-full z-40 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <label className="sr-only" htmlFor={`${kind.toLocaleLowerCase()}-switcher-search`}>Search {kind.toLocaleLowerCase()}s</label>
      <input ref={input} id={`${kind.toLocaleLowerCase()}-switcher-search`} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded="true"
        aria-activedescendant={options[active] ? `${kind.toLocaleLowerCase()}-option-${options[active].id}` : undefined} value={search}
        onChange={event => { setSearch(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(index + 1, options.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && options[active]) { event.preventDefault(); select(options[active].id); }
        }} placeholder={`Search ${kind.toLocaleLowerCase()}s…`}
        className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-factorize-500 focus:ring-2 focus:ring-factorize-500/30 dark:border-slate-700 dark:bg-slate-950" />
      <ul id={listId} role="listbox" aria-label={`${kind}s`} className="mt-2 max-h-64 overflow-y-auto">
        {loading && <li role="status" className="px-3 py-2 text-sm text-slate-500">Loading {kind.toLocaleLowerCase()}s…</li>}
        {error && <li role="alert" className="px-3 py-2 text-sm text-red-700">{error}</li>}
        {!loading && !error && items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No {kind.toLocaleLowerCase()}s yet.</li>}
        {!loading && !error && items.length > 0 && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching {kind.toLocaleLowerCase()}s.</li>}
        {options.map((item, index) => <li key={item.id} id={`${kind.toLocaleLowerCase()}-option-${item.id}`} role="option" aria-selected={item.id === currentId}
          className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${index === active ? "bg-factorize-50 text-slate-950 dark:bg-slate-800 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}
          onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => select(item.id)}>
          <span className="block truncate">{item.name}</span>{item.id === currentId && <span className="ml-2 text-xs text-slate-500">Current</span>}
        </li>)}
      </ul>
    </div>}
  </div>;
}
