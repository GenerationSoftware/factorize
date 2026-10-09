import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import https from 'node:https';
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import pg from 'pg';

// Real public wire operations only; no imports from the backend or mocked OAuth helpers.
test('local OAuth consent and device grants authorize REST/MCP and respect revocation', { timeout: 90_000, skip: !process.env.AUTH_TEST_DATABASE_URL }, async () => {
  const base = new URL(process.env.AUTH_TEST_DATABASE_URL);
  // Wrangler requires a password even when the disposable CI database trusts localhost.
  if (!base.password) base.password = 'local-runtime-only';
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Requires disposable loopback PostgreSQL');
  const admin = new pg.Client({ connectionString: base.href }); await admin.connect();
  const name = 'factorize_protocol_' + randomUUID().replaceAll('-', '');
  const directory = await mkdtemp(tmpdir() + '/factorize-protocol-');
  let db, child;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); base.pathname = '/' + name;
    db = new pg.Client({ connectionString: base.href }); await db.connect();
    for (const file of (await readdir('packages/api/migrations')).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await db.query(await readFile('packages/api/migrations/' + file, 'utf8'));
    const tenantId = randomUUID(), userId = randomUUID(), email = 'protocol@example.test';
    await db.query('INSERT INTO app.tenants(id,name) VALUES ($1,$2)', [tenantId, 'Protocol fixture']);
    await db.query('INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,$2,true)', [userId, email]);
    await db.query("INSERT INTO app.members(tenant_id,user_id,email,role) VALUES ($1,$2,$3,'owner')", [tenantId, userId, email]);
    const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const origin = `https://localhost:${port}`, secret = randomBytes(32).toString('hex');
    const body = Buffer.from(JSON.stringify({ tenantId, userId, email, exp: Math.floor(Date.now()/1000)+600, sessionVersion: 1 })).toString('base64url');
    const cookie = 'factorize_session=' + encodeURIComponent(body + '.' + createHmac('sha256', secret).update(body).digest('base64'));
    child = spawn('npm', ['exec', '--workspace=factorize', '--', 'wrangler', 'dev', '--local', '--local-protocol', 'https', '--port', String(port), '--persist-to', directory, '--var', `APP_ORIGIN:${origin}`, '--var', `SESSION_SIGNING_SECRET:${secret}`, '--var', `CREDENTIAL_ENCRYPTION_KEY:${randomBytes(32).toString('base64')}`], { detached: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: base.href } });
    await new Promise((resolve, reject) => {
      let readyOutput = ''; const deadline = setTimeout(() => reject(new Error('Local protocol Worker did not start')), 30000);
      const chunk = value => { readyOutput += value; if (readyOutput.includes('Ready on')) { clearTimeout(deadline); resolve(); } };
      child.stdout.on('data', chunk); child.stderr.on('data', chunk); child.once('exit', code => { clearTimeout(deadline); reject(new Error('Worker exited ' + code)); });
    });
    const send = (path, method = 'GET', data, headers = {}) => new Promise((resolve, reject) => {
      const request = https.request(origin + path, { method, rejectUnauthorized: false, headers }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const text = Buffer.concat(chunks).toString(); let json; try { json = JSON.parse(text); } catch {} resolve({ status: response.statusCode, headers: response.headers, text, json }); });
      }); request.setTimeout(15000, () => request.destroy(new Error('Protocol request timed out'))); request.on('error', reject); request.end(data);
    });
    const json = (path, data, headers = {}) => send(path, 'POST', JSON.stringify(data), { 'Content-Type': 'application/json', ...headers });
    const owner = { Cookie: cookie, Origin: origin };
    const form = (path, data) => send(path, 'POST', new URLSearchParams(data).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    const registration = await json('/oauth/register', { client_name: 'Protocol fixture', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] });
    assert.equal(registration.status, 201, registration.text); const clientId = registration.json.client_id;
    const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizationQuery = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'http://127.0.0.1/callback', scope: 'flows:read', state: 'fixture-state', code_challenge: challenge, code_challenge_method: 'S256', resource: origin+'/mcp' }).toString();
    const screen = await send('/authorize?'+authorizationQuery, 'GET', undefined, owner); assert.equal(screen.status, 200); assert.match(screen.text, /\/assets\//);
    const preview = await json('/api/v1/oauth/consent/preview', { authorizationQuery }, owner); assert.equal(preview.status, 200, preview.text);
    const decision = { request: preview.json.request, signature: preview.json.signature, decision: 'allow', scopes: ['flows:read'] };
    assert.equal((await json('/api/v1/oauth/consent/decision', decision, { ...owner, Origin: 'https://evil.test' })).status, 403);
    const consent = await json('/api/v1/oauth/consent/decision', decision, owner); assert.equal(consent.status, 200, consent.text);
    const destination = new URL(consent.json.redirectTo); assert.equal(destination.searchParams.get('state'), 'fixture-state');
    const exchange = await form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, code: destination.searchParams.get('code'), redirect_uri: 'http://127.0.0.1/callback', code_verifier: verifier, resource: origin+'/mcp' }); assert.equal(exchange.status, 200, exchange.text);
    const bearer = { Authorization: 'Bearer '+exchange.json.access_token };
    // OAuth resource remains /mcp; do not broaden its audience during migration.
    assert.equal((await send('/api/v1/job-summaries', 'GET', undefined, bearer)).status, 401);
    const key = await json('/api/v1/access-tokens', { name: 'Protocol fixture', scopes: ['flows:read'], expiryDays: 7 }, owner); assert.equal(key.status, 201, key.text);
    const restBearer = { Authorization: 'Bearer '+key.json.token };
    assert.equal((await send('/api/v1/job-summaries', 'GET', undefined, restBearer)).status, 200);
    assert.equal((await send('/api/v1/access-tokens', 'GET', undefined, restBearer)).status, 403);
    assert.equal((await send('/api/v1/runs', 'GET', undefined, restBearer)).status, 403);
    const rpc = async (method, params, id, credentials = bearer) => {
      const result = await json('/mcp', { jsonrpc: '2.0', id, method, params }, { ...credentials, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' });
      assert.equal(result.status, 200, result.text);
      return result.json ?? JSON.parse(result.text.split('\n').find(line => line.startsWith('data: ')).slice(6));
    };
    assert.ok((await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }, 1)).result);
    assert.ok((await rpc('tools/list', {}, 2)).result.tools.some(tool => tool.name === 'list_jobs'));
    assert.deepEqual((await rpc('tools/call', { name: 'list_jobs', arguments: {} }, 3)).result.structuredContent.items, []);
    assert.deepEqual((await rpc('tools/call', { name: 'list_jobs', arguments: {} }, 5, restBearer)).result.structuredContent.items, []);
    const deviceClient = await json('/oauth/register', { client_name: 'Device fixture', token_endpoint_auth_method: 'none', grant_types: ['urn:ietf:params:oauth:grant-type:device_code','refresh_token'] }); assert.equal(deviceClient.status, 201, deviceClient.text);
    const device = await form('/oauth/device_authorization', { client_id: deviceClient.json.client_id, scope: 'flows:read', resource: origin+'/mcp' }); assert.equal(device.status, 200, device.text);
    const poll = { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: deviceClient.json.client_id, device_code: device.json.device_code };
    assert.equal((await form('/oauth/token', poll)).json.error, 'authorization_pending');
    assert.equal((await json('/api/v1/oauth/device/preview', { userCode: device.json.user_code }, owner)).status, 200);
    const approval = await json('/api/v1/oauth/device/decision', { userCode: device.json.user_code, decision: 'allow' }, owner); assert.equal(approval.status, 200, approval.text);
    const deviceToken = await form('/oauth/token', poll); assert.equal(deviceToken.status, 200, deviceToken.text);
    assert.deepEqual((await rpc('tools/call', { name: 'list_jobs', arguments: {} }, 6, { Authorization: 'Bearer '+deviceToken.json.access_token })).result.structuredContent.items, []);
    assert.equal((await form('/oauth/token', poll)).json.error, 'expired_token');
    await db.query('UPDATE app.members SET session_version=2 WHERE tenant_id=$1 AND user_id=$2', [tenantId,userId]);
    assert.equal((await send('/api/v1/job-summaries', 'GET', undefined, bearer)).status, 401);
    const revoked = await rpc('tools/call', { name: 'list_jobs', arguments: {} }, 4); assert.ok(revoked.error || revoked.result?.isError);
    assert.equal((await send('/api/v1/job-summaries', 'GET', undefined, restBearer)).status, 401);
    const revokedDevice = await rpc('tools/call', { name: 'list_jobs', arguments: {} }, 7, { Authorization: 'Bearer '+deviceToken.json.access_token }); assert.ok(revokedDevice.error || revokedDevice.result?.isError);
  } finally {
    if (child) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve)); }
    await db?.end(); await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); await rm(directory, { recursive: true, force: true });
  }
});
