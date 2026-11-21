import { Link } from "@tanstack/react-router";
import { NavIcon } from "../../shared/nav-icon";
export const tabClasses=(active:boolean)=>`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-factorize-500 ${active?"border-factorize-500 text-factorize-700 dark:text-factorize-500":"border-transparent text-slate-600 hover:border-stone-300 dark:text-slate-300"}`;
export function TeamNavigation({pathname}:{pathname:string}){
 return <nav aria-label="Dashboard navigation" className="border-t border-stone-200 dark:border-slate-800"><div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">{([["/skills","skills","Skills"],["/runs","runs","Runs"],["/vms","runs","VMs"],["/clients","users","Clients"],["/integrations","integrations","Integrations"],["/settings","settings","Settings"]] as const).map(([to,icon,label])=>{const active=pathname===to||pathname.startsWith(to+"/");return <Link key={to} to={to} className={tabClasses(active)} aria-current={active?"page":undefined}><NavIcon name={icon}/>{label}</Link>;})}</div></nav>;
}
