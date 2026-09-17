import { Hono } from "hono";

type Bindings = { ASSETS: Fetcher; APP_ORIGIN: string };
const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

const page = (appOrigin: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factorize: Software Factories for Everybody</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/bee-mark.svg"></head><body><header><nav><a class="brand" href="/">🐝 Factorize</a><a class="login" href="${appOrigin}/">Log in</a></nav></header><main>
<p class="eyebrow">Linear → Exe.dev → Herdr</p><h1>No-code Software Factories</h1><p class="lede">Create a multiplayer software factory with <a href="https://linear.app/">Linear</a>, <a href="https://exe.dev/">Exe.dev</a> and <a href="https://herdr.dev/">Herdr</a>.</p><div class="actions"><a class="primary" href="${appOrigin}/">Create a Job</a><a class="secondary" href="https://github.com/GenerationSoftware/factorize">Host it Yourself</a></div>
<section><p class="eyebrow">How it works</p><h2>Choose when to fully automate</h2><p>Factorize routes Linear issues to your coding agent of choice running on your exe.dev VM.</p><ol><li><b>Plan work in Linear</b><span>Define bugs, features, and product work as Linear issues.</span></li><li><b>Issues are routed to agents</b><span>Factorize listens to Linear and sends issues to agents on your VM.</span></li><li><b>Watch, guide, or take over</b><span>Connect to the VM and steer agents together with your colleagues.</span></li></ol></section></main><footer>Open-source software factories for everybody. · <a href="https://github.com/GenerationSoftware/factorize">View on GitHub</a></footer></body></html>`;

app.get("/", (c) => c.html(page(c.env.APP_ORIGIN)));
app.get("/health", (c) => c.json({ ok: true }));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
