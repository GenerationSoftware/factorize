import { createRoute, lazyRouteComponent, redirect, notFound, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { skillQuery, skillsQuery } from "./queries";
import { runStatuses } from "../../shared/ui";
export function skillsRoutes(root:AnyRootRoute){
 const guard=async({location}:{location:{href:string}})=>{if(!(await queryClient.ensureQueryData(sessionQuery)).authenticated)throw redirect({to:"/auth/login",search:{returnTo:location.href,token:undefined}});};
 const list=createRoute({getParentRoute:()=>root,path:"/skills",beforeLoad:guard,validateSearch:(s:Record<string,unknown>)=>({cursor:typeof s.cursor==="string"?s.cursor:undefined,previous:typeof s.previous==="string"?s.previous:undefined}),loaderDeps:({search})=>({cursor:search.cursor}),loader:({deps})=>{void queryClient.prefetchQuery(skillsQuery("",deps.cursor));},component:lazyRouteComponent(()=>import("./library"),"SkillsLibrary")});
 const component=lazyRouteComponent(()=>import("./detail"),"SkillDetail");
 const detail=createRoute({getParentRoute:()=>root,path:"/skills/$skillId",beforeLoad:guard,loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),component});
 const runs=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/runs",beforeLoad:guard,loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),validateSearch:(s:Record<string,unknown>)=>({cursor:typeof s.cursor==="string"?s.cursor:undefined,previous:typeof s.previous==="string"?s.previous:undefined,states:(Array.isArray(s.states)?s.states:typeof s.states==="string"?[s.states]:[]).filter(v=>runStatuses.includes(v)) as typeof runStatuses[number][],sort:["source","run","status","created","agent"].includes(String(s.sort))?s.sort as "run"|"status"|"created"|"source"|"agent":undefined,direction:s.direction==="asc"||s.direction==="desc"?s.direction:undefined}),component});
 const triggers=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/triggers",beforeLoad:guard,loader:({params})=>queryClient.ensureQueryData(skillQuery(params.skillId)),component});
 const settings=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/settings",beforeLoad:async context=>{await guard(context);throw redirect({to:"/skills/$skillId/triggers",params:context.params,replace:true});}});
 const section=createRoute({getParentRoute:()=>root,path:"/skills/$skillId/settings/$section",beforeLoad:async context=>{await guard(context);const params=context.params as {skillId:string;section:string};if(!["general","vm","permissions","trigger"].includes(params.section))throw notFound();throw redirect({to:params.section==="trigger"?"/skills/$skillId/triggers":"/skills/$skillId",params:{skillId:params.skillId},replace:true});}});
 return [list,detail,runs,triggers,settings,section];
}
