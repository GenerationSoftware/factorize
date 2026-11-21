import { useId, useLayoutEffect } from "react";
import { menuItemClasses, popoverClasses, usePopover } from "./popover";

export type MenuAction = { label: string; onClick?: () => void; href?: string; external?: boolean; destructive?: boolean; disabled?: boolean };
export function ActionMenu({ name, actions }: { name: string; actions: MenuAction[] }) {
  const id = useId(), popover = usePopover({ align: "end", width: 224 });
  useLayoutEffect(() => { if (popover.open) popover.panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus(); }, [popover.open]);
  return <>
    <button ref={element => { popover.anchor.current = element; }} type="button" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={popover.open} aria-controls={id} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-xl hover:bg-stone-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => popover.setOpen(!popover.open)} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); popover.setOpen(true); } }}>⋯</button>
    {popover.open && <div ref={popover.panel} id={id} popover="manual" role="menu" aria-label={`${name} actions`} className={popoverClasses} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== popover.anchor.current) popover.setOpen(false); }} onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLElement); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
    }}>{actions.map(action => {
      const className = `${menuItemClasses} ${action.destructive ? "text-red-700 dark:text-red-400" : ""}`;
      const close = () => { popover.close(); action.onClick?.(); };
      return action.href ? <a key={action.label} role="menuitem" href={action.href} onClick={close} className={className} {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}>{action.label}</a> : <button type="button" role="menuitem" key={action.label} disabled={action.disabled} onClick={close} className={className}>{action.label}</button>;
    })}</div>}
  </>;
}
