# MCP Event webhooks

Factorize exposes one stable MCP Events type, `factorize.occurrence`, over the authenticated `/mcp` endpoint. Its required `event_id` argument is the UUID from `create_event` or `list_events`, not a name or a catalog enum. Create an Event and use its UUID immediately; creating or renaming Event definitions never changes the MCP catalog. Subscriptions use the connected OAuth grant, require `triggers:read` in the definition's tenant, and receive only newly recorded occurrences for that definition.

Use `events/subscribe` with `name: "factorize.occurrence"`, `arguments: { "event_id": "<uuid>" }` and the client's verified webhook delivery configuration. Repeat the same name, arguments and callback URL to refresh or unsubscribe. An occurrence can be delivered to several distinct matching subscriptions. All carry `name: "factorize.occurrence"` and the same `occurrenceId` and `definitionId` in `data`; subscription IDs are distinct. Use `read_event_occurrences` for the committed payload and its definition revision.

## One-time rollout

After the updated server is deployed, refresh the installed MCP plugin's metadata once and verify it exposes `factorize.occurrence` with the UUID argument. No further refresh is needed to subscribe to a newly created Factorize Event. Keep existing subscriptions in place: legacy `factorize.event.<definition-id>` subscriptions keep their original signed envelope name and may renew or unsubscribe with their original empty arguments. The new catalog does not list those names. If migrating a client, confirm the new subscription receives the intended definition before stopping the old one, and deduplicate overlapping deliveries by occurrence ID.

## Webhook egress

The Factorize Worker sends callbacks directly over HTTPS. It rejects private IP literals and local-only hostnames, prevents redirects, and limits the time and bytes used to read a verification echo. Cloudflare's public fetch path resolves each hostname and restricts the address used for the actual connection. TLS verifies the hostname from the original URL. Keep `global_fetch_strictly_public` enabled in the existing Worker configuration to avoid private zone-origin routing. [Cloudflare public fetch routing](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/compatibility-date.capnp), [Cloudflare's public network default](https://github.com/cloudflare/workerd/discussions/1523)

## Delivery and recovery

The occurrence and its outbox rows commit together. Subscription activation and occurrence insertion take the same transaction lock per definition. Each outbox row belongs to one activation generation, so refreshing an active subscription keeps its queued deliveries, while reactivating a stopped or expired one starts a new generation. Expiry defaults to 24 hours and is capped at seven days. A replaced secret is the primary signing key immediately, with a five-minute dual-signing window.

The Worker alarm claims due rows and checks current grant, owner, scope, subscription status, and expiry before sending. A retry after an interrupted or uncertain attempt uses the same occurrence ID and a fresh signature. Callback acceptance means the endpoint returned a successful HTTP status.

For one exact occurrence, call the read-only `read_event_delivery_diagnostics` MCP tool with an owner credential scoped to `triggers:read`. It distinguishes a missing occurrence (not found) from an existing occurrence with no delivery records. Up to 100 most recently updated rows describe each delivery's opaque subscription ID, status, attempts, allowlisted outcome code, HTTP status, and timestamps. A pending row can include its next attempt time. `truncated` indicates more rows exist. An accepted delivery confirms callback receipt only, not task execution. The diagnostic does not expose callback details or contents, and cannot retry a delivery.
In PostgreSQL, `app.mcp_event_deliveries` records the attempt count, status, last outcome, and HTTP status.

## Mocked Dot pilot

The mock saves the subscribed definition ID. For a wake with occurrence IDs, it calls `read_event_occurrences` once per ID. For an empty wake, it uses the saved ID and a recent overlapping `since` value, paging until `nextCursor` is null. The mock tracks already summarized occurrence IDs in its context. Without prior context an overlapping window can summarize an occurrence again.

The PostgreSQL suite uses the real MCP handler, occurrence writes, and dispatcher, with an in-process callback receiver that verifies signatures independently. The mock calls the real read tool and checks the visible summary. This fixture records commit observation at the successful producer response and callback acceptance at the receiver response.

| Wake | Commit observed (UTC) | Callback accepted (UTC) | First tool read (UTC) | Summary completed (UTC) |
| --- | --- | --- | --- | --- |
| Normal | 05:48:54.849 | 05:48:54.900 | 05:48:54.921 | 05:48:55.002 |
| Burst of three | 05:48:55.201–05:48:55.488 | 05:48:55.543–05:48:55.587 | 05:48:55.604 | 05:48:55.823 |
| Empty | 05:48:55.928 | 05:48:55.976 | 05:48:55.996 | 05:48:56.409 |

These timestamps are from the November 24, 2026 mock run. Set `FACTORIZE_MOCK_DOT_TIMELINE=1` when running `test/mcp-events.postgres.test.ts` to print the per-occurrence timestamps. No live ChatGPT workspace or Dot was used.
