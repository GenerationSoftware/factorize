import {PI_CLI_VERSION,PI_SESSION_VERSION} from "./pi-trace";
import type {TraceSources} from "./trace-source";

/** Historical provider labels remain readable; every new managed agent is hosted Pi. */
export type AgentKind="codex"|"claude"|"pi";
export function historicalTraceSources(kind:AgentKind,runId:string,nativeOnly=false):TraceSources {
 if(kind==="codex" && !nativeOnly)return {primary:{kind:"execution_stream",path:`/tmp/factorize-artifacts/${runId}/codex-exec.jsonl`,mediaType:"application/x-ndjson",provider:"codex",formatVersion:"codex-exec-jsonl"}};
 if(kind==="pi")return {primary:{kind:"native_session",path:`/tmp/factorize-artifacts/${runId}/pi`,mediaType:"application/x-ndjson",provider:"pi",cliVersion:PI_CLI_VERSION,formatVersion:PI_SESSION_VERSION,discoverCommand:`find '/tmp/factorize-artifacts/${runId}/pi' -type f -name '*.jsonl' -print | head -1`}};
 if(kind==="claude")return {primary:{kind:"native_session",path:"$HOME/.claude/projects",mediaType:"application/x-ndjson",provider:"claude",discoverCommand:`find "$HOME/.claude/projects" -type f -name '*${runId}.jsonl' -print | head -1`}};
 return {primary:{kind:"native_session",path:`/tmp/factorize-artifacts/${runId}`,mediaType:"application/x-ndjson",provider:"codex"}};
}
