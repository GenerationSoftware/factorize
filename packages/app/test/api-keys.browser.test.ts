// @vitest-environment happy-dom
import { SubmitEvent } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKeysSettingsPage } from "../src/ui";

declare const document: any;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderPage = (fetchMock: ReturnType<typeof vi.fn>) => {
  vi.stubGlobal("fetch", fetchMock);
  const html = apiKeysSettingsPage({ email: "owner@example.com" });
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  if (!script) throw new Error("API keys page script was not rendered");
  new Function(script)();
  return document.querySelector("#token-form")!;
};

const completeForm = (form: any) => {
  form.elements.namedItem("name").value = "Deploy token";
  form.querySelector('[name="scope"]').checked = true;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("rendered access token form", () => {
  it("submits once, reveals the token, refreshes the list, and restores the button", async () => {
    let finishCreate!: (response: Response) => void;
    const pendingCreate = new Promise<Response>((resolve) => { finishCreate = resolve; });
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/access/authorized-clients") return Promise.resolve(json([]));
      if (path === "/api/v1/access-tokens" && init?.method === "POST") return pendingCreate;
      if (path === "/api/v1/access-tokens") return Promise.resolve(json([]));
      throw new Error(`Unexpected request: ${path}`);
    });
    const form = renderPage(fetchMock);
    completeForm(form);
    const submit = form.querySelector('button[type="submit"]')!;

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submit }));
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Creating…');
    form.dispatchEvent(new SubmitEvent('submit',{cancelable:true}));
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/v1/access-tokens" && init?.method === "POST")).toHaveLength(1);

    finishCreate(json({ token: "fact_once_only" }, 201));
    await flush();
    await flush();

    expect(document.querySelector("#new-token-value")?.textContent).toBe("fact_once_only");
    expect(document.querySelector("#new-token")?.classList.contains("hidden")).toBe(false);
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/v1/access-tokens" && !init?.method)).toHaveLength(2);
    expect(submit.disabled).toBe(false);
  });

  it("shows API errors in the form and restores the button", async () => {
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/access/authorized-clients") return Promise.resolve(json([]));
      if (path === "/api/v1/access-tokens" && init?.method === "POST") return Promise.resolve(json({ error: "Token name already exists" }, 422));
      if (path === "/api/v1/access-tokens") return Promise.resolve(json([]));
      throw new Error(`Unexpected request: ${path}`);
    });
    const form = renderPage(fetchMock);
    completeForm(form);
    const submit = form.querySelector('button[type="submit"]')!;

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submit }));
    await flush();

    const error = document.querySelector("#token-form-error")!;
    expect(error.textContent).toBe("Token name already exists");
    expect(error.classList.contains("hidden")).toBe(false);
    expect(document.querySelector("#new-token")?.classList.contains("hidden")).toBe(true);
    expect(submit.disabled).toBe(false);
  });
});

it.each(["token","client"])("retains a pending %s and removes it only after confirmation, even if reconciliation fails", async kind=>{
  let finish!: (response: Response)=>void,failRead=false;
  vi.stubGlobal("confirm",()=>true);
  const fetcher=vi.fn(async (input: unknown,init?: RequestInit)=>{
    const url=String(input);
    if(init?.method==="DELETE")return new Promise<Response>(resolve=>{finish=resolve});
    if(failRead)return json({error:"Read unavailable"},503);
    return json(url.includes("authorized-clients")?
      [{clientId:"client-1",clientName:"Editor",scopes:[]}]:[{id:"token-1",name:"Deploy",scopes:[]}]);
  });
  renderPage(fetcher);await flush();
  const button=document.querySelector(kind==="token"?"[data-revoke-token]":"[data-disconnect-client]");
  const article=button.closest("article");
  button.click();button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe(kind==="token"?"Revoking…":"Disconnecting…");
  expect(article.isConnected).toBe(true);
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==="DELETE")).toHaveLength(1);
  failRead=true;finish(json({deleted:true}));await flush();await flush();
  expect(article.isConnected).toBe(false);
  expect(document.querySelector("#access-error").textContent).toBe("Read unavailable");
});

it("keeps the server-created secret visible when list reconciliation fails",async()=>{
  let created=false;
  const fetcher=vi.fn(async(input: unknown,init?: RequestInit)=>{
    if(init?.method==="POST"){created=true;return json({token:"fact_confirmed"})}
    if(created)return json({error:"Read unavailable"},503);
    return json([]);
  });
  const form=renderPage(fetcher);completeForm(form);
  form.dispatchEvent(new SubmitEvent("submit",{cancelable:true}));
  await flush();await flush();
  expect(document.querySelector("#new-token-value").textContent).toBe("fact_confirmed");
  expect(document.querySelector("#token-form-error").classList.contains("hidden")).toBe(true);
  expect(document.querySelector("#access-error").textContent).toBe("Read unavailable");
});
