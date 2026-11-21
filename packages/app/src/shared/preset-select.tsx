import { Children, isValidElement, useId, useRef, useState, type ComponentProps } from "react";
import { fieldClasses } from "./ui";
import { menuItemClasses, popoverClasses, usePopover } from "./popover";

/** A styled single-select for preset forms, keeping a native control for validation/submission. */
export function PresetSelect({ children, className = "", id: suppliedId, value, defaultValue, disabled, onChange, ...props }: ComponentProps<"select">) {
  const generatedId = useId(), id = suppliedId ?? generatedId, native = useRef<HTMLSelectElement>(null);
  const popover = usePopover({ width: "anchor" }), [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", at: 0 });
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<ComponentProps<"option">>(child) || child.type !== "option") return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: !!child.props.disabled }];
  });
  const selected = String(value ?? defaultValue ?? options[0]?.value ?? "");
  const show = () => { setActive(Math.max(0, options.findIndex(option => option.value === selected))); popover.setOpen(true); };
  const choose = (index: number) => { const option = options[index]; if (!option || option.disabled || !native.current) return; native.current.value = option.value; native.current.dispatchEvent(new Event("change", { bubbles: true })); popover.close(); };
  return <span className="block min-w-0">
    <select {...props} ref={native} tabIndex={-1} aria-hidden="true" aria-label={undefined} id={`${id}-native`} className="sr-only" value={value} defaultValue={defaultValue} disabled={disabled} onChange={onChange} onInvalid={event => { event.preventDefault(); popover.anchor.current?.focus(); show(); }}>{children}</select>
    <button ref={element => { popover.anchor.current = element; }} type="button" id={id} role="combobox" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-expanded={popover.open} aria-controls={`${id}-options`} aria-activedescendant={popover.open ? `${id}-option-${active}` : undefined} aria-required={props.required} disabled={disabled} className={`${fieldClasses} flex items-center justify-between gap-3 text-left ${className}`} onClick={() => popover.open ? popover.setOpen(false) : show()} onBlur={event => { if (!popover.panel.current?.contains(event.relatedTarget as Node)) popover.setOpen(false); }} onKeyDown={event => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); if (!popover.open) { show(); return; }
        const direction = event.key === "ArrowUp" ? -1 : 1;
        let index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : active + direction;
        for (let count = 0; count < options.length; count++) { index = (index + options.length) % options.length; if (!options[index].disabled) break; index += direction; }
        setActive(index); document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
      } else if (["Enter", " "].includes(event.key)) { event.preventDefault(); popover.open ? choose(active) : show(); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) { const now = Date.now(); typeahead.current = { text: (now - typeahead.current.at < 750 ? typeahead.current.text : "") + event.key.toLowerCase(), at: now }; const index = options.findIndex(option => !option.disabled && String(option.label).toLowerCase().startsWith(typeahead.current.text)); if (index >= 0) { popover.setOpen(true); setActive(index); } }
    }}><span className="truncate">{options.find(option => option.value === selected)?.label ?? "Choose an option"}</span><span aria-hidden="true" className="text-xs">▾</span></button>
    {popover.open && <div ref={popover.panel} popover="manual" id={`${id}-options`} role="listbox" aria-label={props["aria-label"] ?? "Options"} className={popoverClasses}>{options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === selected} aria-disabled={option.disabled} onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)} className={`${menuItemClasses} cursor-pointer ${option.disabled ? "opacity-50" : ""} ${index === active ? "bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500" : ""}`}>{option.label}</div>)}</div>}
  </span>;
}
