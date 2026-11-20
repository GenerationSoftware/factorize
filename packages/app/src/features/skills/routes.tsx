import { createRoute, lazyRouteComponent, redirect, notFound, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { skillQuery, skillsQuery } from "./queries";
import { runStatuses } from "../../shared/ui";
export function skillsRoutes(root:AnyRootRoute){
 const guard=async({location}:{location:{href:string}})=>{if(!(await queryClient.ensureQueryData(sessionQuery)).authenticated)throw redirect({to:"/auth/login",search:{returnTo:location.href,token:undefined}});};
 const list=createRoute({getParentRoute:()=>root,path:"/skills",beforeLoad:guard,validateSearch:(s:Record<string,unknown>)=>({view:s.view==="graph"?"graph" as const:undefined}),loader:()=>queryClient.ensureQueryData(skillsQuery()),component:lazyRouteComponent(()=>import("./library"),"SkillsLibrary")});
 const component=lazyRouteComponent(()=>import("./detail"),"SkillDetail");
 const detail=createRoute({getParentRoute:()=>root,path:"/skills/$skillId",beforeLoad:guard,loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),component});
 const runs=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/runs",beforeLoad:guard,loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),validateSearch:(s:Record<string,unknown>)=>({cursor:typeof s.cursor==="string"?s.cursor:undefined,previous:typeof s.previous==="string"?s.previous:undefined,states:(Array.isArray(s.states)?s.states:typeof s.states==="string"?[s.states]:[]).filter(v=>runStatuses.includes(v)) as typeof runStatuses[number][],sort:["source","run","status","created","agent"].includes(String(s.sort))?s.sort as "run"|"status"|"created"|"source"|"agent":undefined,direction:s.direction==="asc"||s.direction==="desc"?s.direction:undefined}),component});
 const settings=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/settings",beforeLoad:({params})=>{throw redirect({to:"/skills/$skillId/settings/$section",params:{...params,section:"general"},replace:true});}});
 const section=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/settings/$section",beforeLoad:async context=>{await guard(context);if(!["general","vm","permissions","trigger"].includes((context.params as {skillId:string;section:string}).section))throw notFound();},loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),component});
 return [list,detail,runs,settings,section];
}
