// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { settingsPage } from "../src/ui";
declare const document: any;
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve()};
const json=(body: unknown)=>Response.json(body);
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML=""});
it.each(["github","tail","exe"])("retains a %s connection while removal is pending and blocks repeated actions",async kind=>{
  let finish!: (response: Response)=>void,removed=false;
  vi.stubGlobal("confirm",()=>true);
  const fetcher=vi.fn(async(input: unknown,init?: RequestInit)=>{
    const url=String(input);
    if(init?.method==="DELETE")return new Promise<Response>(resolve=>{finish=resolve});
    if(url.includes("github/installations"))return json(removed&&kind==="github"?[]:[{installationId:1,state:"active",accountLogin:"owner"}]);
    if(url.includes("cloudflare-tail"))return json(removed&&kind==="tail"?[]:[{integrationId:"tail-1",name:"Tail"}]);
    return json({exeConnections:removed&&kind==="exe"?[]:[{connectionId:"exe-1",agentKind:"codex"}]});
  });
  vi.stubGlobal("fetch",fetcher);
  const html=settingsPage({email:"owner@example.com"});
  document.body.innerHTML=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1];
  new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1])();
  await flush();
  const selector=kind==="github"?"[data-disconnect-github]":kind==="tail"?"[data-disconnect-tail]":"[data-remove-integration]";
  const button=document.querySelector(selector),article=button.closest("article");
  button.click();button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe(kind==="exe"?"Removing…":"Disconnecting…");
  expect(article.isConnected).toBe(true);
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==="DELETE")).toHaveLength(1);
  removed=true;finish(json({deleted:true}));await flush();
  expect(document.querySelector(selector)).toBeNull();
});
it("shows Testing immediately and only reports a successful Amp test after its response",async()=>{
  let finish!: (response: Response)=>void;
  const fetcher=vi.fn(async(input: unknown,init?: RequestInit)=>{
    if(init?.method==="POST")return new Promise<Response>(resolve=>{finish=resolve});
    return json(String(input)==="/api/v1/integrations"?{}:[]);
  });
  vi.stubGlobal("fetch",fetcher);
  const html=settingsPage({email:"owner@example.com"});
  document.body.innerHTML=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1];
  new Function([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1])();
  await flush();
  const button=document.querySelector("#test-amp");
  button.click();button.click();
  expect(button.textContent).toBe("Testing…");
  expect(document.querySelector("#amp-message").textContent).not.toContain("succeeded");
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  finish(json({ok:true}));await flush();
  expect(document.querySelector("#amp-message").textContent).toContain("succeeded");
  expect(button.disabled).toBe(false);
});
