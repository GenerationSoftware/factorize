import { Link } from "@tanstack/react-router";
import { tabClasses } from "../auth/team-navigation";
export function SkillNavigation({skillId,tab}:{skillId:string;tab:"overview"|"runs"|"triggers"}){
 return <nav aria-label="Skill navigation" className="border-b border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950"><div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">{([["overview","Overview","/skills/$skillId"],["runs","Runs","/skills/$skillId/runs"],["triggers","Triggers","/skills/$skillId/triggers"]] as const).map(([id,label,to])=><Link key={id} to={to} params={{skillId}} className={tabClasses(tab===id)} aria-current={tab===id?"page":undefined}>{label}</Link>)}</div></nav>;
}
