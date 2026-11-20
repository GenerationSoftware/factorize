import {readFileSync} from 'node:fs';
// Feed the tools/list result captured by a client; never needs credentials.
const input=JSON.parse(readFileSync(process.argv[2]??0,'utf8'));
const tools=(input.result??input).tools;
if(!Array.isArray(tools))throw new Error('Expected an MCP tools/list result with a tools array.');
const names=new Set(tools.map(tool=>tool.name.split('__').at(-1).replace(/^factorize_/,'')));
const missing=['get_api_reflection','request_api','read_api_response'].filter(name=>!names.has(name));
console.log(JSON.stringify({status:missing.length?'missing_tools':'catalog_complete',missing,next:missing.length?'Compare this client catalog with authenticated server tools/list. Refresh/reconnect the connector if the server includes these tools. Missing tools are a discovery/deployment issue, not an integration credential error.':'Call get_api_reflection, then request_api using its requestExample. insufficient_scope requires renewed OAuth consent; forbidden means integration policy; credential_unavailable means the owner must repair credentials.'},null,2));
process.exitCode=missing.length?1:0;
