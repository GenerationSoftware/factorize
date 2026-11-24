import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const namespace = "factorize-skills";

// Inventory the whole dedicated namespace, including retired libraries and mirrors.
export async function purgeSkillArtifacts({ accountId, token, apply = false, fetcher = fetch, pause = delay }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? "") || !token) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  }
  const reposUrl = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/artifacts/namespaces/${namespace}/repos`);
  const request = (url, method = "GET") => fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const envelope = async (response, operation) => {
    if (!response.ok) throw new Error(`${operation} failed (HTTP ${response.status}).`);
    const body = await response.json();
    if (!body.success) throw new Error(`${operation} was rejected by Cloudflare.`);
    return body;
  };
  async function inventory() {
    const url = new URL(reposUrl);
    url.searchParams.set("limit", "200");
    const repositories = new Set();
    const cursors = new Set();
    for (;;) {
      const body = await envelope(await request(url), "List skill repositories");
      if (!Array.isArray(body.result)) throw new Error("Unexpected repository inventory.");
      for (const repo of body.result) {
        if (typeof repo.name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(repo.name)) {
          throw new Error("Unexpected repository name in inventory.");
        }
        repositories.add(repo.name);
      }
      const cursor = body.result_info?.cursor;
      if (!cursor) return [...repositories].sort();
      if (typeof cursor !== "string" || cursors.has(cursor)) throw new Error("Invalid inventory cursor.");
      cursors.add(cursor);
      url.searchParams.set("cursor", cursor);
    }
  }

  const repositories = await inventory();
  if (!apply) return repositories;

  for (const repo of repositories) {
    const url = new URL(`${reposUrl.href}/${encodeURIComponent(repo)}`);
    const response = await request(url, "DELETE");
    if (response.status !== 404) await envelope(response, `Delete ${repo}`);
  }
  // Cloudflare accepts deletions asynchronously. Confirm that no repos remain.
  for (let attempt = 0; attempt < 25; attempt++) {
    const remaining = await inventory();
    if (!remaining.length) return repositories;
    await pause(5000);
  }
  throw new Error("The skill namespace is still nonempty. Rerun the purge after checking repository status.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== "--apply")) throw new Error("Usage: node scripts/purge-skill-artifacts.mjs [--apply]");
  const apply = args[0] === "--apply";
  const repositories = await purgeSkillArtifacts({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    apply,
  });
  console.log(`${namespace}: ${repositories.length} repositories ${apply ? "purged, inventory now empty" : "eligible for purge"}`);
  for (const repo of repositories) console.log(repo);
}
