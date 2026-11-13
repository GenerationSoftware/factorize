import { runProcess } from './portable-proxy-test-helpers.mjs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (command, args, timeout = 180_000) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 8 * 1024 * 1024 }).trim();
if (process.version !== 'v24.12.0' || run('npm', ['--version']) !== '11.19.0') throw new Error('Docker E2E requires Node 24.12.0 and npm 11.19.0. Use the documented Factorize validation runner.');
if (!process.env.AUTH_TEST_DATABASE_URL) throw new Error('Docker E2E requires an isolated local database. Run npm run bootstrap:test and export the printed variables.');
const database = new URL(process.env.AUTH_TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Docker E2E refuses remote/shared databases. Run npm run bootstrap:test.');
try { run('docker', ['info'], 15_000); } catch { throw new Error('Docker daemon is required. Start Docker and verify docker info before npm run test:docker.'); }
try { run('psql', [database.href, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'], 15_000); }
catch { throw new Error('Local PostgreSQL is unavailable. Run npm run bootstrap:test with the isolated validation URL and export its database variables.'); }
const tls = await mkdtemp(join(tmpdir(), 'factorize-docker-e2e-'));
const namespace = `fz-${randomUUID()}`;
const databaseName = `docker_e2e_${randomUUID().replaceAll('-', '')}`;
const cancellation = new AbortController();
const interrupted = signal => cancellation.abort(signal);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupted);
try {
  const hostIp = JSON.parse(run('docker', ['network', 'inspect', 'bridge']))[0].IPAM.Config[0].Gateway;
  run('openssl', ['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(tls,'ca.key'), '-out', join(tls,'ca.crt'), '-days', '1', '-subj', '/CN=Factorize-Local-Test-CA']);
  run('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(tls,'server.key'), '-out', join(tls,'server.csr'), '-subj', '/CN=localhost']);
  await writeFile(join(tls,'server.ext'), `subjectAltName=DNS:localhost,DNS:proxy.local,DNS:fake-api.local,IP:${hostIp},IP:127.0.0.1\nextendedKeyUsage=serverAuth\n`);
  run('openssl', ['x509', '-req', '-in', join(tls,'server.csr'), '-CA', join(tls,'ca.crt'), '-CAkey', join(tls,'ca.key'), '-CAcreateserial', '-out', join(tls,'server.crt'), '-days', '1', '-extfile', join(tls,'server.ext')]);
  // Only synthetic fixture TLS files are shared with the proxy/fake service, never the job.
  await chmod(tls, 0o755); await chmod(join(tls,'server.key'), 0o644);
  console.log('Preparing cached local job and deployable proxy images (no registry publication).');
  run('docker', ['build', '-f', 'packages/api/test/fixtures/Dockerfile.code-job', '-t', 'factorize-test-code-local', '.']);
  run('docker', ['build', '-f', 'packages/credential-proxy/Dockerfile', '-t', 'factorize-test-proxy-local', '.']);
  const jobImage = run('docker', ['image', 'inspect', '--format', '{{.Id}}', 'factorize-test-code-local']);
  const proxyImage = run('docker', ['image', 'inspect', '--format', '{{.Id}}', 'factorize-test-proxy-local']);
  const result = await runProcess('npm', ['exec', '--workspace=factorize', '--', 'vitest', 'run', '--config', 'scripts/docker-code-job.config.ts'], {
    timeoutMs: 150_000, signal: cancellation.signal,
    env: { ...process.env, NODE_EXTRA_CA_CERTS: join(tls, 'ca.crt'), FACTORIZE_E2E_TLS_DIR: tls,
      FACTORIZE_E2E_HOST_IP: hostIp, FACTORIZE_E2E_JOB_IMAGE: jobImage, FACTORIZE_E2E_PROXY_IMAGE: proxyImage,
      FACTORIZE_E2E_NAMESPACE: namespace, FACTORIZE_E2E_DATABASE: databaseName },
    onOutput: (stream, chunk) => (stream === 'stderr' ? process.stderr : process.stdout).write(chunk),
  });
  process.exitCode = result.code;

} finally {
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupted);
  // Independent fallback after failures/signals. Lifecycle assertions run in the test before this.
  for (const scope of [namespace, `${namespace}-jobs`, `${namespace}-infra`]) {
    try {
      const ids = run('docker', ['ps', '-aq', '--filter', `label=sh.factorize.test.namespace=${scope}`], 10_000).split('\n').filter(Boolean);
      for (const id of ids) run('docker', ['rm', '-f', id], 10_000);
    } catch { console.error('Docker E2E fallback cleanup needs manual inspection for namespace ' + scope); }
  }
  for (const network of [`${namespace}-jobs`, `${namespace}-api`, `${namespace}-infra`]) { try { run('docker', ['network', 'rm', network], 10_000); } catch {} }
  try { run('psql', [database.href, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`], 10_000); }
  catch { console.error('Remove isolated E2E database ' + databaseName + ' after stopping its runner.'); }
  await rm(tls, { recursive: true, force: true });
}
