import { usePopover, popoverClasses, menuItemClasses } from "../../shared/popover";
import { useId, useState } from "react";
import { Input, Label } from "../../shared/ui";
import type { Preset, PresetKind } from "./preset-queries";
export const presetLabel = (presets:Preset[],kind:PresetKind,slug?:string) => {
 const selected=presets.find(p=>p.kind===kind&&(slug?p.slug===slug:p.isDefault));
 return slug ? selected?.name??`Unavailable · ${slug}` : `Team default${selected?` · ${selected.name}`:" · not configured"}`;
};
export function PresetCombobox({kind,presets,value,onChange,disabled=false}:{kind:PresetKind;presets:Preset[];value?:string;onChange:(slug:string|undefined)=>void;disabled?:boolean}){
 const id=useId(),{open,setOpen,anchor,panel}=usePopover({width:"anchor"}),[query,setQuery]=useState(""),[active,setActive]=useState(0);
 const label=kind==="vm"?"VM preset":kind==="permission"?"Permission preset":"Model preset";
 const options=[{slug:undefined as string|undefined,label:presetLabel(presets,kind)},...presets.filter(p=>p.kind===kind).map(p=>({slug:p.slug,label:`${p.name} · ${p.slug}`}))].filter(p=>p.label.toLowerCase().includes(query.toLowerCase()));
 const choose=(index:number)=>{const item=options[index];if(!item)return;onChange(item.slug);setOpen(false);setQuery("");};
 const unavailable=value&&!presets.some(p=>p.kind===kind&&p.slug===value);
 return <div onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}><Label htmlFor={id}>{label}</Label><div className="relative"><Input ref={element=>{anchor.current=element;}} id={id} role="combobox" autoComplete="off" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-options`} aria-activedescendant={open&&options[active]?`${id}-${active}`:undefined} disabled={disabled} value={open?query:presetLabel(presets,kind,value)} onFocus={()=>{setOpen(true);setQuery("");setActive(0);}} onClick={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setActive(0);setOpen(true);}} onKeyDown={e=>{
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setOpen(true);setActive(n=>options.length?(n+(e.key==="ArrowDown"?1:options.length-1))%options.length:0);}
  if(e.key==="Enter"&&open){e.preventDefault();choose(active);}
  if(e.key==="Escape"){e.preventDefault();setOpen(false);}
 }}/>{open&&<div ref={panel} popover="manual" id={`${id}-options`} role="listbox" aria-label={`${label} options`} className={popoverClasses}>{options.map((option,index)=><div id={`${id}-${index}`} role="option" aria-selected={index===active} key={option.slug??"default"} className={`${menuItemClasses} cursor-pointer ${index===active?"bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500":""}`} onPointerDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(index)}>{option.label}</div>)}{!options.length&&<div className="p-3 text-sm">No matching presets.</div>}</div>}</div>{unavailable&&<p role="alert" className="mt-1 text-sm">This preset is unavailable. Choose a replacement or Team default.</p>}</div>;
}
