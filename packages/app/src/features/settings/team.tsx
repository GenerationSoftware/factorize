import { PresetList } from "./presets";
import { Link } from "@tanstack/react-router";
import { SettingsFrame } from "./navigation";
import { SkillsRepository } from "../skills/repository";
import type { ReactNode } from "react";
export function TeamSettingsLayout({title,children}:{title:string;children:ReactNode}) {
  return <SettingsFrame title={title} navigation={<nav aria-label="Team settings" className="flex flex-wrap gap-2 border-b pb-4 text-sm font-semibold md:flex-col md:border-b-0">{([["/settings/vm","VM"],["/settings/permissions","Permissions"],["/settings/models","Models"],["/settings/skills","Skills"]] as const).map(([to,label])=><Link key={to} to={to} className="rounded-lg px-3 py-2 hover:bg-stone-100 dark:hover:bg-slate-800" activeProps={{className:"bg-factorize-50 text-factorize-700 dark:bg-factorize-500/10 dark:text-factorize-500","aria-current":"page"}}>{label}</Link>)}</nav>}>{children}</SettingsFrame>;
}
export function TeamVmSettings(){return <PresetList kind="vm"/>;}
export function TeamPermissionSettings(){return <PresetList kind="permission"/>;}
export function TeamSkillSettings(){return <TeamSettingsLayout title="Skills settings"><SkillsRepository/></TeamSettingsLayout>;}

export function TeamModelSettings(){return <PresetList kind="model"/>;}
