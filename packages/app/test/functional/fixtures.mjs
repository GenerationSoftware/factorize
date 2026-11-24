import { test as base } from "@playwright/test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const dist = new URL("../../dist/", import.meta.url);
const publicFiles = new Set(["/theme-init.js", "/bee-mark-monochrome.png", "/favicon.ico"]);
const contentTypes = {
  js: "application/javascript",
  css: "text/css",
  png: "image/png",
  ico: "image/x-icon",
  html: "text/html",
};

export const test = base.extend({
  origin: [async ({}, use) => {
    const server = createServer(async (request, response) => {
      const path = new URL(request.url, "http://fixture").pathname;
      const file = publicFiles.has(path) || /^\/assets\/[\w.-]+$/.test(path) ? path : "/index.html";
      try {
        const body = await readFile(new URL("." + file, dist));
        response.setHeader("Content-Type", contentTypes[file.split(".").at(-1)] ?? "application/octet-stream");
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }, { scope: "worker" }],
});

export { expect } from "@playwright/test";
