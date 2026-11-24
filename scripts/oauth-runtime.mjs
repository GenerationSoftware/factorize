import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";

async function* readSse(response) {
  response.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of response) {
    buffer += chunk;
    let separator;
    while ((separator = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) yield JSON.parse(data);
    }
  }
}

async function nextNotification(events, method) {
  for (;;) {
    const { value: message, done } = await events.next();
    assert.ok(!done, `MCP stream ended before ${method}`);
    assert.ok(!message.error, JSON.stringify(message));
    if (message.method === method) return message.params;
  }
}

export async function checkOAuth({ read: send, stream, db, tenantId, userId, cookie, appOrigin: origin }) {
  const json = (path, data, headers = {}) => send(path, 'POST', JSON.stringify(data), { 'Content-Type': 'application/json', ...headers });
  const owner = { Cookie: cookie, Origin: origin };
  const form = (path, data) => send(path, 'POST', new URLSearchParams(data).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
  const registration = await json('/oauth/register', { client_name: 'Protocol fixture', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] });
  assert.equal(registration.status, 201, registration.text); const clientId = registration.json.client_id;
  const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'http://127.0.0.1:62311/callback';
  const authorizationQuery = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: "team:read triggers:read triggers:write integrations:read", state: 'fixture-state', code_challenge: challenge, code_challenge_method: 'S256', resource: origin+'/mcp' }).toString();
  for (const invalidRedirect of ['http://localhost:62311/callback', redirectUri + '/other']) {
    const query = new URLSearchParams(authorizationQuery);
    query.set('redirect_uri', invalidRedirect);
    assert.equal((await send('/authorize?' + query, 'GET', undefined, owner)).status, 400);
  }
  const screen = await send('/authorize?'+authorizationQuery, 'GET', undefined, owner); assert.equal(screen.status, 302);
  const connectionCookie = screen.headers['set-cookie'][0].split(';')[0];
  const connectedScreen = await send(new URL(screen.headers.location).pathname + new URL(screen.headers.location).search, 'GET', undefined, { ...owner, Cookie: cookie + '; ' + connectionCookie }); assert.equal(connectedScreen.status, 200); assert.match(connectedScreen.text, /\/assets\//);
  const preview = await json('/api/v1/oauth/consent/preview', { authorizationQuery }, owner); assert.equal(preview.status, 200, preview.text);
  const originalScopes = ['team:read', 'triggers:read', 'triggers:write', 'integrations:read'];
  const decision = { request: preview.json.request, signature: preview.json.signature, decision: 'allow', scopes: originalScopes };
  assert.equal((await json('/api/v1/oauth/consent/decision', decision, { ...owner, Origin: 'https://evil.test' })).status, 403);
  const consent = await json('/api/v1/oauth/consent/decision', decision, owner); assert.equal(consent.status, 200, consent.text);
  const destination = new URL(consent.json.redirectTo); assert.equal(destination.searchParams.get('state'), 'fixture-state');
  const exchange = await form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, code: destination.searchParams.get('code'), redirect_uri: redirectUri, code_verifier: verifier, resource: origin+'/mcp' }); assert.equal(exchange.status, 200, exchange.text);
  const bearer = { Authorization: 'Bearer '+exchange.json.access_token };
  // OAuth resource remains /mcp; do not broaden its audience during migration.
  assert.equal((await send('/api/v1/triggers', 'GET', undefined, bearer)).status, 401);
  const key = await json('/api/v1/access-tokens', { name: 'Protocol fixture', scopes: originalScopes, expiryDays: 7 }, owner); assert.equal(key.status, 201, key.text);
  const restBearer = { Authorization: 'Bearer '+key.json.token };
  assert.equal((await send('/api/v1/triggers', 'GET', undefined, restBearer)).status, 200);
  assert.equal((await send('/api/v1/access-tokens', 'GET', undefined, restBearer)).status, 403);
  assert.equal((await send('/api/v1/events', 'GET', undefined, restBearer)).status, 200);
  const rpc = async (method, params, id, credentials = bearer) => {
    const result = await json('/mcp', { jsonrpc: '2.0', id, method, params }, { ...credentials, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' });
    assert.equal(result.status, 200, result.text);
    return result.json ?? JSON.parse(result.text.split('\n').find(line => line.startsWith('data: ')).slice(6));
  };
  assert.ok((await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }, 1)).result);
  assert.ok((await rpc('tools/list', {}, 2)).result.tools.some(tool => tool.name === 'list_triggers'));
  assert.deepEqual((await rpc('tools/call', { name: 'list_triggers', arguments: {} }, 3)).result.structuredContent.items, []);
  assert.deepEqual((await rpc('tools/call', { name: 'list_triggers', arguments: {} }, 5, restBearer)).result.structuredContent.items, []);

  const payloadSchema = { type: 'object' };
  const restEvent = await json('/api/v1/events', { name: 'rest.event', payloadSchema }, restBearer);
  assert.equal(restEvent.status, 201, restEvent.text);
  const restEventPath = `/api/v1/events/${restEvent.json.id}`;
  const restUpdate = await send(restEventPath, 'PUT', JSON.stringify({ name: 'rest.event', description: 'Updated over REST', payloadSchema, expectedRevision: restEvent.json.revision }), { ...restBearer, 'Content-Type': 'application/json' });
  assert.equal(restUpdate.status, 200, restUpdate.text);
  assert.equal(restUpdate.json.revision, 2);
  assert.equal((await send(restEventPath, 'DELETE', undefined, restBearer)).status, 200);
  assert.equal((await send(restEventPath, 'GET', undefined, restBearer)).status, 404);

  const eventTool = async (name, args, id) => {
    const response = await rpc('tools/call', { name, arguments: args }, id, restBearer);
    assert.ok(response.result?.structuredContent, JSON.stringify(response));
    return response.result.structuredContent;
  };
  const mcpEvent = await eventTool('create_event', { name: 'mcp.event', payloadSchema }, 20);
  const update = await eventTool('update_event', { eventId: mcpEvent.id, name: 'mcp.event', description: 'Updated over MCP', payloadSchema, expectedRevision: mcpEvent.revision }, 21);
  assert.equal(update.revision, 2);
  assert.equal((await eventTool('delete_event', { eventId: mcpEvent.id }, 22)).deleted, true);
  assert.equal((await send(`/api/v1/events/${mcpEvent.id}`, 'GET', undefined, restBearer)).status, 404);

  const modernHeaders = {
    ...bearer,
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
  };
  const clientMeta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "Factorize quickstart fixture", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const modernRpc = async (method, params, headers = {}) => {
    const result = await json("/mcp", { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: clientMeta } }, {
      ...modernHeaders, "Mcp-Method": method, ...headers,
    });
    assert.equal(result.status, 200, result.text);
    const message = result.json ?? JSON.parse(result.text.split("\n").find(line => line.startsWith("data: ")).slice(6));
    assert.ok(!message.error && !message.result?.isError, JSON.stringify(message));
    return message.result;
  };
  const tool = async (name, args) => (await modernRpc("tools/call", { name, arguments: args }, { "Mcp-Name": name })).structuredContent;
  const event = await tool("create_event", {
    name: "review.requested",
    payloadSchema: {
      type: "object", required: ["orderId"], additionalProperties: false,
      properties: { orderId: { $ref: "#/definitions/orderId" } },
      definitions: { orderId: { type: "string" } },
    },
  });
  const discovery = await modernRpc("server/discover", {});
  assert.deepEqual(discovery.capabilities.events, {});
  const catalog = await modernRpc("events/list", {});
  assert.ok(catalog.events.some(definition => definition.name === `factorize.event.${event.id}` &&
    definition.title === "review.requested" && definition.delivery.includes("webhook")));
  const trigger = await tool("create_trigger", {
    name: "manual-review", eventId: event.id, sources: [{ kind: "manual", config: {} }],
  });
  const templates = await modernRpc("resources/templates/list", {});
  const template = templates.resourceTemplates.find(resource => resource.name === "event-occurrences");
  assert.ok(template, JSON.stringify(templates));
  const uri = template.uriTemplate.replace("{eventId}", event.id);
  const subscription = {
    jsonrpc: "2.0", id: 2, method: "subscriptions/listen",
    params: { notifications: { resourceSubscriptions: [uri] }, _meta: clientMeta },
  };
  const response = await stream("/mcp", "POST", JSON.stringify(subscription), {
    ...modernHeaders, "Mcp-Method": subscription.method, "Content-Type": "application/json",
  }, { signal: AbortSignal.timeout(15_000) });
  const events = readSse(response);
  const fire = (key, orderId) => tool("fire_trigger", { triggerId: trigger.id, idempotencyKey: key, data: { orderId } });
  try {
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /^text\/event-stream/);
    const acknowledged = await nextNotification(events, "notifications/subscriptions/acknowledged");
    assert.deepEqual(acknowledged.notifications.resourceSubscriptions, [uri]);

    const first = await fire("review-1", "order-42");
    assert.ok(first.occurrenceId);
    assert.equal(first.duplicate, false);
    assert.deepEqual(await fire("review-1", "order-42"), { occurrenceId: first.occurrenceId, duplicate: true });
    assert.equal((await nextNotification(events, "notifications/resources/updated")).uri, uri);
    const resource = await modernRpc("resources/read", { uri }, { "Mcp-Name": uri });
    const stored = JSON.parse(resource.contents[0].text).items;
    assert.deepEqual(stored.map(({ id, payload }) => ({ id, payload })), [
      { id: first.occurrenceId, payload: { orderId: "order-42" } },
    ]);
  } finally {
    response.destroy();
    await events.return();
  }
  const missed = await fire("review-2", "order-43");
  const recovered = await tool("read_event_occurrences", { occurrenceId: missed.occurrenceId });
  assert.deepEqual(recovered.items[0].payload, { orderId: "order-43" });
  const catchup = await tool("list_event_occurrences", { eventId: event.id });
  assert.equal(catchup.items.length, 2);
  assert.deepEqual(catchup.items[0].payload, { orderId: "order-43" });
  assert.equal(catchup.items[0].id, missed.occurrenceId);
  const restOccurrences = await send(`/api/v1/events/${event.id}/occurrences`, "GET", undefined, restBearer);
  assert.equal(restOccurrences.status, 200, restOccurrences.text);
  assert.deepEqual(restOccurrences.json.items, catchup.items);
  assert.equal((await tool("delete_event", { eventId: event.id })).deleted, true);

  const rename = name => rpc('tools/call', {name: 'rename_mcp_client', arguments: {name}}, 8);
  const invalidName = await rename('   ');
  assert.ok(invalidName.result?.isError || invalidName.error);
  assert.equal((await rename('  Release assistant  ')).result.structuredContent.name, 'Release assistant');
  const clients = await send('/api/v1/access/authorized-clients', 'GET', undefined, owner);
  const connection = clients.json.find(client => client.clientId === clientId);
  assert.equal(connection.clientName, 'Release assistant');
  const integrationId = randomUUID();
  await db.query("INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available) VALUES ($1,$2,'linear','linear','Linear',true)", [tenantId,integrationId]);
  const permissionsPath = '/api/v1/access/authorizations/' + connection.grantId + '/permissions';
  const change = (edit, headers = owner) => send(permissionsPath, 'PUT', JSON.stringify(edit), {...headers, 'Content-Type':'application/json'});
  const integrationKey = 'integration:' + integrationId + ':1';
  const edit = {scopes: ['team:read', 'integrations:read', integrationKey], expectedRevision: 0};
  assert.equal((await change(edit, restBearer)).status, 403);
  assert.equal((await change({...edit, scopes: [...edit.scopes, 'unknown:scope']})).status, 400);
  const saved = await change(edit);
  assert.equal(saved.status, 200, saved.text);
  assert.equal((await change(edit)).status, 409);
  const blocked = await rpc('tools/call', {name:'list_triggers',arguments:{}}, 9);
  assert.ok(blocked.error || blocked.result?.isError);
  const reflect = async (credentials = bearer) => (await rpc('tools/call', {name:'get_api_reflection',arguments:{}}, 10, credentials)).result.structuredContent;
  assert.equal((await reflect()).integrations.find(row => row.id === integrationId).access, 'requestable');

  // Newly selected scopes are carried by a freshly authorized credential.
  const freshVerifier = randomBytes(32).toString('base64url');
  const freshQuery = new URLSearchParams(authorizationQuery);
  freshQuery.set('scope', [...edit.scopes, 'proxy:use'].join(' '));
  freshQuery.set('state', 'fixture-reauthorize');
  freshQuery.set('code_challenge', createHash('sha256').update(freshVerifier).digest('base64url'));
  const freshPreview = await json('/api/v1/oauth/consent/preview', {authorizationQuery: freshQuery.toString()}, owner);
  assert.equal(freshPreview.status, 200, freshPreview.text);
  const freshConsent = await json('/api/v1/oauth/consent/decision', {
    request: freshPreview.json.request, signature: freshPreview.json.signature, decision: 'allow', scopes: [...edit.scopes, 'proxy:use'],
  }, owner);
  assert.equal(freshConsent.status, 200, freshConsent.text);
  const freshDestination = new URL(freshConsent.json.redirectTo);
  assert.equal(freshDestination.searchParams.get('state'), 'fixture-reauthorize');
  const freshExchange = await form('/oauth/token', {
    grant_type: 'authorization_code', client_id: clientId, code: freshDestination.searchParams.get('code'),
    redirect_uri: redirectUri, code_verifier: freshVerifier, resource: origin+'/mcp',
  });
  assert.equal(freshExchange.status, 200, freshExchange.text);
  const freshBearer = { Authorization: 'Bearer '+freshExchange.json.access_token };
  assert.equal((await reflect(freshBearer)).integrations.find(row => row.id === integrationId).access, 'granted');
  assert.equal((await change({scopes: originalScopes, expectedRevision: 1})).status, 200);
  assert.equal((await reflect()).integrations.find(row => row.id === integrationId).access, 'unavailable');
  assert.deepEqual((await rpc('tools/call', {name:'list_triggers',arguments:{}}, 11)).result.structuredContent.items, []);
  const deviceClient = await json('/oauth/register', { client_name: 'Device fixture', token_endpoint_auth_method: 'none', grant_types: ['urn:ietf:params:oauth:grant-type:device_code','refresh_token'] }); assert.equal(deviceClient.status, 201, deviceClient.text);
  const device = await form('/oauth/device_authorization', { client_id: deviceClient.json.client_id, scope: "team:read triggers:read integrations:read", resource: origin+'/mcp' }); assert.equal(device.status, 200, device.text);
  const poll = { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: deviceClient.json.client_id, device_code: device.json.device_code };
  assert.equal((await form('/oauth/token', poll)).json.error, 'authorization_pending');
  const devicePreview = await json('/api/v1/oauth/device/preview', { userCode: device.json.user_code }, owner); assert.equal(devicePreview.status, 200);
  const approval = await json('/api/v1/oauth/device/decision', { userCode: device.json.user_code, signature: devicePreview.json.signature, decision: 'allow' }, owner); assert.equal(approval.status, 200, approval.text);
  assert.equal((await form('/oauth/token', poll)).json.error, 'slow_down');
  await db.query("UPDATE app.oauth_device_authorizations SET record=jsonb_set(record,'{lastPolledAt}',to_jsonb(extract(epoch from now())::bigint-20)) WHERE device_code=$1", [device.json.device_code]);
  const deviceToken = await form('/oauth/token', poll); assert.equal(deviceToken.status, 200, deviceToken.text);
  assert.deepEqual((await rpc('tools/call', { name: 'list_triggers', arguments: {} }, 6, { Authorization: 'Bearer '+deviceToken.json.access_token })).result.structuredContent.items, []);
  assert.equal((await form('/oauth/token', poll)).json.error, 'expired_token');
  await db.query('UPDATE app.members SET session_version=2 WHERE tenant_id=$1 AND user_id=$2', [tenantId,userId]);
  assert.equal((await send('/api/v1/triggers', 'GET', undefined, bearer)).status, 401);
  const revoked = await rpc('tools/call', { name: 'list_triggers', arguments: {} }, 4); assert.ok(revoked.error || revoked.result?.isError);
  assert.equal((await send('/api/v1/triggers', 'GET', undefined, restBearer)).status, 401);
  const revokedDevice = await rpc('tools/call', { name: 'list_triggers', arguments: {} }, 7, { Authorization: 'Bearer '+deviceToken.json.access_token }); assert.ok(revokedDevice.error || revokedDevice.result?.isError);
}
