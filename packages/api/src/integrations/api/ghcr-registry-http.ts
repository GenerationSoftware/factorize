import { AgentApiError } from "../../proxy/api/agent-api-error";
import type { Env } from "../../types";
import { checkGhcrLogin, ghcrWorkloadCredential, readGhcrLogin } from "../application/ghcr-workload";
import { forwardGhcrRegistry } from "../providers/ghcr-registry";

const protocol = {"Docker-Distribution-Api-Version":"registry/2.0","Cache-Control":"private, no-store"};
function error(status: number, code: string, message: string, authentication = false, head = false) {
  const headers = new Headers(protocol);
  headers.set("Content-Type","application/json");
  if (authentication) headers.set("WWW-Authenticate", 'Basic realm="Factorize GitHub Container Registry"');
  return new Response(head ? null : JSON.stringify({errors:[{code,message}]}),{status,headers});
}

export async function ghcrRegistryHttp(request: Request, env: Env) {
  const url = new URL(request.url);
  const head = request.method === "HEAD";
  if (url.protocol !== "https:" || url.port || (url.pathname !== "/v2/" && !url.pathname.startsWith("/v2/"))) {
    return error(404,"NAME_UNKNOWN","Not found.",false,head);
  }
  const auth = await readGhcrLogin(env,request);
  if (!auth) return error(401,"UNAUTHORIZED","Use a current Factorize workload registry login.",true,head);
  try {
    const recheck = () => checkGhcrLogin(env,auth);
    await recheck();
    if (url.pathname === "/v2/" && !url.search && (request.method === "GET" || head)) {
      return new Response(head ? null : "{}", {headers:{...protocol,"Content-Type":"application/json"}});
    }
    const credential = await ghcrWorkloadCredential(env,auth);
    if (!credential || !url.pathname.startsWith("/v2/" + credential.image + "/")) throw new AgentApiError(403,"forbidden","Not authorized for this image.");
    const response = await forwardGhcrRegistry(request, credential, {pull:auth.access === "pull",push:auth.access === "push"}, {recheck});
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(protocol)) headers.set(name,value);
    headers.delete("Set-Cookie");
    headers.delete("WWW-Authenticate");
    return new Response(head ? null : response.body, {status:response.status,headers});
  } catch (cause) {
    if (cause instanceof AgentApiError && cause.status === 403) return error(403,"DENIED","The workload is not authorized for this operation.",false,head);
    if (cause instanceof AgentApiError && cause.status === 400) return error(400,"UNSUPPORTED","Unsupported registry request.",false,head);
    return error(502,"UNKNOWN","The registry is unavailable.",false,head);
  }
}
