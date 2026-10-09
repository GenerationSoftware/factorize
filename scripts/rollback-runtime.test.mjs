import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import https from 'node:https';
import { mkdtemp, rm, symlink, cp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('API-first rollback anchor restores legacy pages and retains compiled SPA chunks', { timeout: 60_000 }, async () => {
  const root = process.cwd(), stage = await mkdtemp(tmpdir()+'/factorize-rollback-'); let child;
  try {
    execFileSync('git', ['archive', '--format=tar', '--output='+stage+'/anchor.tar', 'ff4b51b'], { cwd: root });
    execFileSync('tar', ['-xf', stage+'/anchor.tar', '-C', stage]);
    await symlink(resolve(root,'node_modules'), stage+'/node_modules', 'dir');
    await cp('packages/app/dist/assets', stage+'/packages/api/public/assets', { recursive: true });
    const entry = (await readdir('packages/app/dist/assets')).find(file => /^index-.*\.js$/.test(file)); assert.ok(entry);
    const databaseUrl = new URL(process.env.AUTH_TEST_DATABASE_URL ?? 'postgresql://postgres@localhost/factorize_test'); if (!databaseUrl.password) databaseUrl.password = 'local-runtime-only'; const database = databaseUrl.href; assert.ok(['localhost','127.0.0.1'].includes(new URL(database).hostname));
    const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, [resolve(root,'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--local-protocol', 'https', '--port', String(port), '--var', `APP_ORIGIN:https://localhost:${port}`], { cwd: stage+'/packages/api', detached: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database } });
    await new Promise((resolve,reject) => { let output=''; const timeout=setTimeout(()=>reject(new Error('Rollback Worker did not start')),30000); const chunk=value=>{ output+=value; if(output.includes('Ready on')) { clearTimeout(timeout); resolve(); } }; child.stdout.on('data',chunk);child.stderr.on('data',chunk);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Rollback Worker exited '+code+': '+output));}); });
    const read = path => new Promise((resolve,reject)=> { const request=https.get(`https://localhost:${port}${path}`, {rejectUnauthorized:false}, response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));});request.setTimeout(10000,()=>request.destroy(new Error('Rollback request timed out')));request.on('error',reject); });
    const login=await read('/auth/login'); assert.equal(login.status,200);assert.match(login.body.toString(),/Sign in/);assert.match(login.headers['content-security-policy'],/nonce-/);
    const session=await read('/api/v1/session');assert.equal(session.status,200);assert.equal(session.headers['x-factorize-contract'],'gen-2157-static-v1');assert.deepEqual(JSON.parse(session.body),{authenticated:false});
    const chunk=await read('/assets/'+entry);assert.equal(chunk.status,200);assert.deepEqual(chunk.body,await readFile('packages/app/dist/assets/'+entry));
    const stylesheet=await read('/styles.css');assert.equal(stylesheet.status,200);assert.ok(stylesheet.body.length>1000);
    const jobs=await read('/jobs');assert.equal(jobs.status,302);assert.equal(jobs.headers.location,'/auth/login');
  } finally {
    if(child){try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}await new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve():child.once('exit',resolve));}
    await rm(stage,{recursive:true,force:true});
  }
});
