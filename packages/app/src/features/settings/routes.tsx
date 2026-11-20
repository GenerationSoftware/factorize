import { createRoute, lazyRouteComponent, redirect, type AnyRootRoute } from "@tanstack/react-router";
import { sessionQuery } from "../auth/session";
import { queryClient } from "../../shared/query-client";
import { AuthScreen } from "../auth/auth-screen";
export function settingsRoutes(root: AnyRootRoute) {
  const guard = async ({ location }: { location: { href: string } }) => { if (!(await queryClient.ensureQueryData(sessionQuery)).authenticated) throw redirect({ to: "/auth/login", search: { returnTo: location.href, token: undefined } }); };
  return [
    createRoute({getParentRoute:()=>root,path:"/uploads/proxy/$handle",beforeLoad:guard,component:lazyRouteComponent(()=>import("./proxy-upload"),"ProxyUpload")}),
    createRoute({ getParentRoute: () => root, path: "/settings/profile", beforeLoad: guard, component: lazyRouteComponent(() => import("./profile"), "Profile") }),
    createRoute({ getParentRoute: () => root, path: "/settings/integrations", beforeLoad: ({ location }) => { throw redirect({ to: "/integrations", search: location.search, hash: location.hash, replace: true }); } }),
    createRoute({ getParentRoute: () => root, path: "/integrations", beforeLoad: guard, component: lazyRouteComponent(() => import("./integrations"), "Integrations") }),
    createRoute({ getParentRoute: () => root, path: "/settings", beforeLoad: async context => { await guard(context); throw redirect({to:"/settings/vm",replace:true}); } }),
    createRoute({ getParentRoute: () => root, path: "/settings/vm", beforeLoad: guard, component: lazyRouteComponent(() => import("./team"), "TeamVmSettings") }),
    createRoute({ getParentRoute: () => root, path: "/settings/permissions", beforeLoad: guard, component: lazyRouteComponent(() => import("./team"), "TeamPermissionSettings") }),
    createRoute({getParentRoute:()=>root,path:"/settings/models",beforeLoad:guard,component:lazyRouteComponent(()=>import("./team"),"TeamModelSettings")}),
    createRoute({getParentRoute:()=>root,path:"/settings/$presetKind/new",beforeLoad:guard,component:lazyRouteComponent(()=>import("./presets"),"PresetEditorPage")}),
    createRoute({getParentRoute:()=>root,path:"/settings/$presetKind/$presetId/edit",beforeLoad:guard,component:lazyRouteComponent(()=>import("./presets"),"PresetEditorPage")}),
    createRoute({ getParentRoute: () => root, path: "/settings/skills", beforeLoad: guard, component: lazyRouteComponent(() => import("./team"), "TeamSkillSettings") }),
    createRoute({ getParentRoute: () => root, path: "/settings/vm-presets", beforeLoad: ()=>{throw redirect({to:"/settings/vm",replace:true});} }),
    createRoute({ getParentRoute: () => root, path: "/settings/api-keys", beforeLoad: guard, component: lazyRouteComponent(() => import("./api-keys"), "ApiKeys") }),
    createRoute({ getParentRoute: () => root, path: "/settings/api-keys/new", beforeLoad: guard, component: lazyRouteComponent(() => import("./api-key-create"), "ApiKeyCreate") }),
    createRoute({ getParentRoute: () => root, path: "/settings/authorized-clients", beforeLoad: guard, component: lazyRouteComponent(() => import("./authorized-clients"), "AuthorizedClients") }),
    createRoute({ getParentRoute: () => root, path: "/settings/password", beforeLoad: guard, component: () => <AuthScreen mode="password" inSettingsLayout /> })];
}
