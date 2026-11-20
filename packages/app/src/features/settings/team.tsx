import { teamQuery } from "./team-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SettingsFrame } from "./navigation";
import { TeamRunDefaults } from "./team-run-defaults";
import { SkillsRepository } from "../skills/repository";
import type { ReactNode } from "react";
export function TeamSettingsLayout({title,children}:{title:string;children:ReactNode}) {
  return <SettingsFrame title={title} navigation={<nav aria-label="Team settings" className="flex flex-wrap gap-2 border-b pb-4 text-sm font-semibold md:flex-col md:border-b-0">{([["/settings/vm","VM"],["/settings/permissions","Permissions"],["/settings/skills","Skills"]] as const).map(([to,label])=><Link key={to} to={to} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800" activeProps={{className:"bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500","aria-current":"page"}}>{label}</Link>)}</nav>}>{children}</SettingsFrame>;
}
export function TeamSettings({section="vm"}:{section?:"vm"|"permissions"|"skills"}) {
  const team=useQuery({...teamQuery,enabled:section!=="skills"});
  return <TeamSettingsLayout title={section==="vm"?"VM settings":section==="permissions"?"Permissions":"Skills settings"}>
    {section==="skills"?<SkillsRepository />:<>{section==="vm"&&<Link to="/settings/vm-presets" className="font-semibold underline">VM presets</Link>}{team.isPending&&<p role="status">Loading team settings…</p>}{team.error&&<p role="alert">{team.error.message}</p>}{team.data&&<TeamRunDefaults key={section} section={section} initial={team.data.runDefaults}/>}</>}
  </TeamSettingsLayout>;
}
export function TeamVmSettings(){return <TeamSettings section="vm"/>;}
export function TeamPermissionSettings(){return <TeamSettings section="permissions"/>;}
export function TeamSkillSettings(){return <TeamSettings section="skills"/>;}
