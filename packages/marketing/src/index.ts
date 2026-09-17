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

const page = (appOrigin: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factorize: Software Factories for Everybody</title><link rel="stylesheet" href="/styles.css?v=2"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"></head><body><header><nav><a class="brand" href="/">🐝 Factorize</a><div class="nav-links"><a href="https://docs.factorize.sh">Docs</a><a class="login" href="${appOrigin}/">Log in</a></div></nav></header><main>
<p class="eyebrow">Triggers → Context → Agents</p><h1>No-code Software Factories</h1><p class="lede">Have your agent design a software factory using your favourite tools.</p><div class="actions"><a class="primary" href="${appOrigin}/">Create a Job</a><a class="secondary github-link" href="https://github.com/GenerationSoftware/factorize"><svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.66 7.66 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>Host it Yourself</a></div>
<section><p class="eyebrow">How it works</p><h2>Choose when to fully automate</h2><p>Factorize gives your agents the triggers, context, and execution targets they need to do useful work.</p><ol><li><b>Set up triggers for agents</b><span>Connect the tools where work starts and choose which events should launch an agent.</span></li><li><b>Build dynamic context</b><span>Shape each run with the issue, relevant provider data, and the context your agent needs.</span></li><li><b>Run agents anywhere you want</b><span>Launch agents on your preferred infrastructure, then watch, guide, or take over as needed.</span></li></ol></section></main><footer>Open-source software factories for everybody. · <a href="https://github.com/GenerationSoftware/factorize">View on GitHub</a></footer></body></html>`;

app.get("/", (c) => c.html(page(c.env.APP_ORIGIN)));
app.get("/health", (c) => c.json({ ok: true }));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
