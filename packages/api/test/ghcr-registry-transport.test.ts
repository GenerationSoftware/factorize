import { describe, expect, it } from "vitest";
import { forwardGhcrRegistry } from "../src/integrations/providers/ghcr-registry";

const credential = { image: "org/my-image", username: "owner", token: "fixture-pat" };
const pull = { pull: true, push: false };
const push = { pull: false, push: true };
const digest = "sha256:" + "a".repeat(64);
const imagePath = "/v2/" + credential.image;
const blob = "/blobs/" + digest;
const session = "/blobs/uploads/id-123?_state=opaque";
const cdn = "https://pkg-containers.githubusercontent.com/ghcr1/blobs/" + digest + "?sig=private";
const upstream = "https://ghcr.io";
const request = (path: string, init?: RequestInit) => new Request("https://ghcr.factorize.sh" + imagePath + path, init);

function fixture(...steps: Array<(url: URL, init: RequestInit, headers: Headers) => Response | Promise<Response>>) {
  let position = 0;
  const errors: unknown[] = [];
  const fetcher: typeof fetch = async (url, init = {}) => {
    try {
      const step = steps[position++];
      return await step(new URL(String(url)), init, new Headers(init.headers));
    } catch (e) { errors.push(e); throw e; }
  };
  return { fetcher, verify: () => { expect(errors).toEqual([]); expect(position).toBe(steps.length); } };
}

function token(actions: string) {
  return (url: URL, init: RequestInit, headers: Headers) => {
    expect(url.origin + url.pathname).toBe(upstream + "/token");
    expect(url.searchParams.get("scope")).toBe("repository:org/my-image:" + actions);
    expect(init.redirect).toBe("manual");
    expect(headers.get("authorization")).toBe("Basic " + btoa("owner:fixture-pat"));
    return Response.json({ token: "fixture-bearer" });
  };
}

describe("GHCR Docker registry transport", () => {
  it("streams a ranged blob from a pinned CDN without forwarding credentials or exposing the URL", async () => {
    const stub = fixture(token("pull"), (url, init, headers) => {
      expect(url.href).toBe(upstream + imagePath + blob);
      expect(headers.get("authorization")).toBe("Bearer fixture-bearer");
      expect(headers.get("cookie")).toBeNull();
      expect(init.redirect).toBe("manual");
      return new Response(null, { status: 307, headers: { Location: cdn } });
    }, (url, init, headers) => {
      expect(url.href).toBe(cdn);
      expect(init.redirect).toBe("manual");
      const sent: Record<string, string> = {};
      headers.forEach((value, name) => { sent[name] = value; });
      expect(sent).toEqual({ "accept-encoding": "identity", range: "bytes=0-1" });
      return new Response(new Uint8Array([0, 255]), { status: 206, headers: {
        "Content-Range": "bytes 0-1/5", "Set-Cookie": "private", Location: cdn, Link: cdn,
      } });
    });
    const response = await forwardGhcrRegistry(request(blob, { headers: {
      Authorization: "Bearer factorize-client", Cookie: "client-secret", Range: "bytes=0-1",
    } }), credential, pull, stub);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/5");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("link")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 255]));
    stub.verify();
  });

  it.each([cdn.replace("githubusercontent.com", "example.com"), cdn.replace(digest, "sha256:" + "b".repeat(64))])(
    "rejects a CDN destination that is not a pinned copy of the requested blob", async location => {
      const stub = fixture(token("pull"), () => new Response(null, { status: 307, headers: { Location: location } }));
      const response = await forwardGhcrRegistry(request(blob), credential, pull, stub);
      expect(response.status).toBe(502);
      expect(response.headers.get("location")).toBeNull();
      stub.verify();
    },
  );

  it("accepts native Docker upload start, chunk, digest commit, and manifest publish", async () => {
    const stub = fixture(token("pull,push"), (url, init) => {
      expect(url.href).toBe(upstream + imagePath + "/blobs/uploads/");
      expect(init.method).toBe("POST");
      return new Response(null, { status: 202, headers: { Location: upstream + imagePath + session } });
    }, token("pull,push"), async (url, init, headers) => {
      expect(url.href).toBe(upstream + imagePath + session);
      expect(init.method).toBe("PATCH");
      expect(headers.get("content-range")).toBe("0-1");
      expect(init.body).toBeInstanceOf(ReadableStream);
      expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(new Uint8Array([0, 255]));
      return new Response(null, { status: 202, headers: { Location: upstream + imagePath + session, Range: "0-1" } });
    }, token("pull,push"), (url, init) => {
      expect(url.searchParams.get("digest")).toBe(digest);
      expect(init.method).toBe("PUT");
      return new Response(null, { status: 201, headers: { Location: upstream + imagePath + blob, "Docker-Content-Digest": digest } });
    }, token("pull,push"), (url, init) => {
      expect(url.href).toBe(upstream + imagePath + "/manifests/latest");
      expect(init.method).toBe("PUT");
      return new Response(null, { status: 201, headers: { Location: upstream + imagePath + "/manifests/latest" } });
    });
    const go = (path: string, init: RequestInit) => forwardGhcrRegistry(request(path, init), credential, push, stub);
    const start = await go("/blobs/uploads/?mount=" + digest + "&from=other/private", { method: "POST" });
    expect(start.status).toBe(202);
    expect(start.headers.get("location")).toBe(imagePath + session);
    const patch = await go(session, { method: "PATCH", body: new Uint8Array([0,255]), headers: { "Content-Range": "0-1" } });
    expect(patch.headers.get("location")).toBe(imagePath + session);
    expect(patch.headers.get("range")).toBe("0-1");
    const commit = await go(session + "&digest=" + digest, { method: "PUT" });
    expect(commit.status).toBe(201);
    expect(commit.headers.get("location")).toBe(imagePath + blob);
    expect((await go("/manifests/latest", { method: "PUT", body: "{}" })).status).toBe(201);
    stub.verify();
  });

  it("checks method, exact image, and live grant before protected requests", async () => {
    const none = fixture();
    expect((await forwardGhcrRegistry(request(blob), credential, push, none)).status).toBe(403);
    expect((await forwardGhcrRegistry(request("/manifests/latest", { method: "PUT" }), credential, pull, none)).status).toBe(403);
    expect((await forwardGhcrRegistry(request("/manifests/latest", { method: "DELETE" }), credential, push, none)).status).toBe(404);
    expect((await forwardGhcrRegistry(new Request("https://ghcr.factorize.sh/v2/org/other" + blob), credential, pull, none)).status).toBe(404);
    none.verify();
    const stub = fixture(token("pull"), () => new Response(null, { status: 307, headers: { Location: cdn } }));
    let count = 0;
    await expect(forwardGhcrRegistry(request(blob), credential, pull, { ...stub,
      recheck: async () => { if (++count === 2) throw new Error("revoked"); },
    })).rejects.toThrow("revoked");
    stub.verify();
  });

  it("rejects hostile upload continuations and sanitizes provider errors", async () => {
    const stub = fixture(token("pull,push"), () => new Response(null, { status: 202, headers: { Location: "https://example.com" + imagePath + session } }),
      token("pull"), () => new Response("fixture-bearer", { status: 401, headers: { "WWW-Authenticate": "fixture-pat" } }));
    const start = await forwardGhcrRegistry(request("/blobs/uploads/", { method: "POST" }), credential, push, stub);
    expect(start.status).toBe(502);
    expect(start.headers.get("location")).toBeNull();
    const read = await forwardGhcrRegistry(request(blob), credential, pull, stub);
    expect(read.status).toBe(403);
    expect(read.headers.get("www-authenticate")).toBeNull();
    expect(await read.text()).not.toContain("fixture-bearer");
    stub.verify();
  });
});
