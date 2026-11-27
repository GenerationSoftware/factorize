/** Measure the complete duplicated MCP result, not merely the upstream body. */
export function proxyToolResult(value:unknown) {
 const handle=value && typeof value==="object" && "handle" in value && "encoding" in value && value.encoding==="base64" ? String(value.handle) : undefined;
 return {content:[{type:"text" as const,text:JSON.stringify(value)},...(handle?[{type:"resource_link" as const,uri:`proxy://responses/${handle}`,name:"Retained response",description:"Use query_api_response or read_api_response for bounded reads."}]:[])],structuredContent:value};
}
export function proxyResultSize(value:unknown) {return new TextEncoder().encode(JSON.stringify(proxyToolResult(value))).length;}
export function proxyReceipt(value:{status:number;headers:Record<string,string>;size:number;encoding:"base64";handle:string;expiresAt:string},budget:number,preview="") {
 const result={...value,headers:{} as Record<string,string>,preview:preview.slice(0,160),instructions:"Use query_api_response for JSON filtering/text/byte ranges, or read_api_response with this handle. Original bytes are retained unchanged."};
 for(const [name,content] of Object.entries(value.headers)){
  result.headers[name]=content;
  if(proxyResultSize(result)>budget)delete result.headers[name];
 }
 if(proxyResultSize(result)>budget)result.preview="";
 return result;
}
