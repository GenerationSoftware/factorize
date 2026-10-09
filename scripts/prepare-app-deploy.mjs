import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { delimiter } from 'node:path';
import { requireApiReady } from './verify-public-routing.mjs';

// The workflow performs its own trusted artifact restoration. Direct deploys
// require the operator to supply the same last-30-days release archives.
const origin = JSON.parse(readFileSync(new URL('../packages/api/wrangler.jsonc', import.meta.url))).vars.APP_ORIGIN;
await requireApiReady(origin);
const login = await fetch(origin + '/auth/login', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
if (login.status !== 200) throw new Error('Cannot identify current frontend; use the production deployment workflow.');
const currentScript = (await login.text()).match(/src="(\/assets\/[^"/]+\.js)"/)?.[1];
const archives = (process.env.FACTORIZE_RETAINED_ASSET_ARCHIVES ?? '').split(delimiter).filter(Boolean);
if (currentScript && !archives.length) throw new Error('Static deployment requires trusted last-30-days release archives in FACTORIZE_RETAINED_ASSET_ARCHIVES; use the production workflow for automatic retention.');
execFileSync('npm', ['run', 'build', '--workspace=factorize-app'], { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
const destination = new URL('../packages/app/dist/', import.meta.url);
mkdirSync(destination, { recursive: true });
writeFileSync(new URL('styles.css', destination), execFileSync('git', ['show', '2d63d6480c398d29513329d7a604a4585d21de24:packages/api/public/styles.css'], { cwd: new URL('..', import.meta.url), maxBuffer: 10 * 1024 * 1024 }));
for (const archive of archives) execFileSync('python3', ['scripts/retain-app-assets.py', archive, 'packages/app/dist'], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
if (currentScript) {
  const retained = readFileSync(new URL('../packages/app/dist' + currentScript, import.meta.url));
  const live = await fetch(origin + currentScript, { signal: AbortSignal.timeout(15000) });
  if (!live.ok || !retained.equals(Buffer.from(await live.arrayBuffer()))) throw new Error('Current deployed entry bundle is absent or differs from retained archives.');
}
