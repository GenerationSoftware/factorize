// Isolated protocol test: never point this harness at an actual registry or daemon
// that hosts other workloads. Start Docker with an isolated data root and socket.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { forwardGhcrRegistry } from "../src/integrations/providers/ghcr-registry.ts";

const registryPort = Number(process.env.GHCR_FIXTURE_REGISTRY_PORT || 5000);
const proxyPort = Number(process.env.GHCR_FIXTURE_PROXY_PORT || 5001);
const mib = Number(process.env.GHCR_FIXTURE_LAYER_MIB || 8);
if (![registryPort, proxyPort, mib].every(Number.isSafeInteger) || mib < 1 || mib > 256 ||
    !process.env.DOCKER_HOST?.startsWith("unix:///tmp/")) throw Error("Use an isolated Docker socket and a bounded layer size");
const host = "127.0.0.1:" + proxyPort;
const image = "fixture/docker-smoke-" + crypto.randomUUID();
const target = host + "/" + image + ":fixture";
const credential = {image,username:"fixture",token:"fixture-only"};
const temporary = await mkdtemp(join(tmpdir(),"ghcr-docker-smoke-"));
let mode = "push";
let uploadBytes = 0, downloadBytes = 0;
const upstream = async (input, init) => {
  const target = new URL(input);
  if (target.origin !== "https://ghcr.io") throw Error("Unexpected upstream");
  const headers = new Headers(init.headers);
  if (target.pathname === "/token") {
    if (headers.get("Authorization") !== "Basic " + btoa("fixture:fixture-only")) throw Error("Missing fixture credential");
    return Response.json({token:"fixture-bearer"});
  }
  if (headers.get("Authorization") !== "Bearer fixture-bearer") throw Error("Missing fixture bearer");
  headers.delete("Authorization");
  const permitted = /^\/v2\/fixture\//.test(target.pathname);
  if (!permitted) throw Error("Unexpected upstream path");
  const body = init.body;
  const collect = new TransformStream({ transform(bytes, controller) { uploadBytes += bytes.byteLength; controller.enqueue(bytes); } });
  const response = await fetch("http://127.0.0.1:" + registryPort + target.pathname + target.search,{
    ...init, headers, body:body && /\/blobs\/uploads\//.test(target.pathname) ? body.pipeThrough(collect) : body,duplex:"half",
  });
  if (!response.ok || init.method !== "GET" || !/\/blobs\/sha256:/.test(target.pathname) || !response.body) return response;
  const read = new TransformStream({ transform(bytes, controller) { downloadBytes += bytes.byteLength; controller.enqueue(bytes); } });
  return new Response(response.body.pipeThrough(read),{status:response.status,headers:response.headers});
};
const fixture = createServer(async (incoming, outgoing) => {
  try {
    const url = "https://ghcr.factorize.sh" + incoming.url;
    const method = incoming.method;
    const request = new Request(url,{method,headers:incoming.headers,body:["POST","PATCH","PUT"].includes(method) ? Readable.toWeb(incoming) : undefined,duplex:"half"});
    let response;
    if (incoming.headers.authorization !== "Basic " + btoa("factorize:fixture-workload")) {
      response = new Response(null,{status:401,headers:{"WWW-Authenticate":'Basic realm="Factorize"',"Docker-Distribution-Api-Version":"registry/2.0"}});
    } else if (incoming.url === "/v2/") {
      response = new Response(null,{headers:{"Docker-Distribution-Api-Version":"registry/2.0"}});
    } else {
      response = await forwardGhcrRegistry(request,credential,{push:mode==="push",pull:mode==="pull"},{fetcher:upstream});
    }
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if (!response.body || method === "HEAD") outgoing.end();
    else await pipeline(Readable.fromWeb(response.body),outgoing);
  } catch {
    if (outgoing.headersSent) outgoing.destroy();
    else { outgoing.writeHead(502); outgoing.end(); }
  }
});
const run = (file, args) => new Promise((resolve,reject) => {
  const child = spawn(file,args,{stdio:"inherit"});
  child.once("error",reject);
  child.once("exit",code => code === 0 ? resolve() : reject(new Error(file + " exited " + code)));
});
try {
  await new Promise((resolve,reject) => fixture.listen(proxyPort,"127.0.0.1",resolve).once("error",reject));
  await writeFile(join(temporary,"config.json"),JSON.stringify({auths:{[host]:{auth:btoa("factorize:fixture-workload")}}}),{mode:0o600});
  const docker = (...args) => run("docker",["--config",temporary,...args]);
  await run("dd",["if=/dev/urandom","of="+join(temporary,"layer"),"bs=1M","count="+mib,"status=none"]);
  await run("tar",["-C",temporary,"-cf",join(temporary,"rootfs.tar"),"layer"]);
  await docker("import",join(temporary,"rootfs.tar"),target);
  await docker("push",target);
  await docker("image","rm",target);
  mode = "pull";
  await docker("pull",target);
  await docker("image","rm",target);
  const floor = mib * 1024 * 1024;
  if (uploadBytes < floor || downloadBytes < floor) throw Error("Docker did not transfer the full layer in both directions.");
  console.log(JSON.stringify({layerMiB:mib,uploadBytes,downloadBytes}));
} finally {
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}
