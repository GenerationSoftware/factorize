import { describe, expect, it } from "vitest";
import { forwardRunOutbound } from "../src/run-outbound-forwarder";
import { isPublicAddress } from "../src/public-address";

describe("backend streaming outbound protocol", () => {
  it("injects Git Basic auth, preserves protocol headers and removes VM/session authority", async () => {
    const request = new Request("https://factorize.test/internal/run-proxy/run/providers/github/17/owner/repo.git/git-upload-pack", {
      method: "POST", headers: {Authorization: "Bearer vendor-token", Cookie: "factorize_session=private", "X-Factorize-Run-Id": "run", "Git-Protocol": "version=2", "Content-Type": "application/x-git-upload-pack-request", Connection: "x-hidden", "X-Hidden": "private", "X-Forwarded-Host": "private"}, body: "pack-request",
    });
    const result = await forwardRunOutbound(request, {origin: "https://github.com", path: "/owner/repo.git/git-upload-pack", credential: "installation-token", authorization: "github-git-basic"}, {
      fetcher: async (input, init) => {
        expect(String(input)).toBe("https://github.com/owner/repo.git/git-upload-pack");
        const headers = init!.headers as Headers;
        expect(headers.get("Authorization")).toBe(`Basic ${btoa("x-access-token:installation-token")}`);
        expect(headers.get("Git-Protocol")).toBe("version=2");
        for (const name of ["Cookie", "X-Factorize-Run-Id", "X-Hidden", "X-Forwarded-Host", "Connection"]) expect(headers.has(name)).toBe(false);
        expect(await new Response(init!.body).text()).toBe("pack-request");
        expect(init!.redirect).toBe("manual");
        return new Response("pack-response", {headers: {"Content-Type": "application/x-git-upload-pack-result", "Set-Cookie": "upstream-session=private", Connection: "x-upstream", "X-Upstream": "hidden"}});
      },
    });
    expect(result.headers.get("Content-Type")).toBe("application/x-git-upload-pack-result");
    expect(result.headers.has("Set-Cookie")).toBe(false);
    expect(result.headers.has("X-Upstream")).toBe(false);
    expect(await result.text()).toBe("pack-response");
  });

  it("exposes streamed response chunks before the upstream finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const body = new ReadableStream<Uint8Array>({async start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      await gate;
      controller.enqueue(new TextEncoder().encode("data: last\n\n")); controller.close();
    }});
    const response = await forwardRunOutbound(new Request("https://factorize.test/"), {origin: "https://api.example.com", path: "/v1/responses", credential: "selected-model"}, {fetcher: async () => new Response(body, {headers: {"Content-Type": "text/event-stream"}})});
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    release();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: last\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("rejects redirects, invalid bindings and oversized streams without exposing a secret", async () => {
    const credential = {origin: "https://api.example.com", path: "/", credential: "secret"};
    await expect(forwardRunOutbound(new Request("https://factorize.test/"), credential, {fetcher: async () => new Response(null, {status: 302, headers: {Location: "https://other.example/"}})})).rejects.toThrow("redirects");
    for (const invalid of [{origin: "http://api.example.com"}, {origin: "https://api.example.com/path"}, {path: "https://other.example/path"}, {path: "/\\other.example"}]) {
      await expect(forwardRunOutbound(new Request("https://factorize.test/"), {...credential, ...invalid})).rejects.toThrow("binding");
    }
    const response = await forwardRunOutbound(new Request("https://factorize.test/"), credential, {responseBytes: 2, fetcher: async () => new Response("oversized")});
    await expect(response.text()).rejects.toThrow("limit");
    await expect(forwardRunOutbound(new Request("https://factorize.test/", {method: "POST", body: "oversized"}), credential, {requestBytes: 2, fetcher: async (_input, init) => new Response(await new Response(init!.body).text())})).rejects.toThrow("limit");
  });

  it("propagates request cancellation and enforces the upstream deadline", async () => {
    const selected={origin:"https://api.example.com",path:"/",credential:"secret"};
    const fetcher: typeof fetch = async (_input,init) => new Promise((_resolve,reject)=> {
      const signal=init!.signal!;
      if(signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
    });
    await expect(forwardRunOutbound(new Request("https://factorize.test/"),selected,{fetcher,timeoutMs:5})).rejects.toMatchObject({name:"TimeoutError"});
    const abort=new AbortController();
    const pending=forwardRunOutbound(new Request("https://factorize.test/",{signal:abort.signal}),selected,{fetcher,timeoutMs:1000});
    abort.abort();await expect(pending).rejects.toMatchObject({name:"AbortError"});
  });

  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"])("rejects non-public address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("accepts globally routable address literals", () => { expect(isPublicAddress("1.1.1.1")).toBe(true); expect(isPublicAddress("2606:4700:4700::1111")).toBe(true); });
});
