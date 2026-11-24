# MCP Event webhooks

Factorize exposes Event definitions over the authenticated `/mcp` endpoint. A definition's protocol name is `factorize.event.<definition-id>`. The catalog uses the current name and description. Subscriptions use the connected OAuth grant, require `triggers:read`, and receive newly recorded occurrences after activation. The webhook contains `occurrenceId` and `definitionId`. Use `read_event_occurrences` for the committed payload and its definition revision.

## Webhook egress

The Factorize Worker sends callbacks directly over HTTPS. It rejects private IP literals and local-only hostnames, prevents redirects, and limits the time and bytes used to read a verification echo. Cloudflare's public fetch path resolves each hostname and restricts the address used for the actual connection. TLS verifies the hostname from the original URL. Keep `global_fetch_strictly_public` enabled in the existing Worker configuration to avoid private zone-origin routing. [Cloudflare public fetch routing](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/compatibility-date.capnp), [Cloudflare's public network default](https://github.com/cloudflare/workerd/discussions/1523)

## Delivery and recovery

The occurrence and its outbox rows commit together. Subscription activation and occurrence insertion take the same transaction lock per definition. Each outbox row belongs to one activation generation, so refreshing an active subscription keeps its queued deliveries, while reactivating a stopped or expired one starts a new generation. Expiry defaults to 24 hours and is capped at seven days. A replaced secret is the primary signing key immediately, with a five-minute dual-signing window.

The Worker alarm claims due rows and checks current grant, owner, scope, subscription status, and expiry before sending. A retry after an interrupted or uncertain attempt uses the same occurrence ID and a fresh signature. Callback acceptance means the endpoint returned a successful HTTP status. In PostgreSQL, `app.mcp_event_deliveries` records the attempt count, status, last outcome, and HTTP status.

## Mocked Dot pilot

The mock saves the subscribed definition ID. For a wake with occurrence IDs, it calls `read_event_occurrences` once per ID. For an empty wake, it uses the saved ID and a recent overlapping `since` value, paging until `nextCursor` is null. The mock tracks already summarized occurrence IDs in its context. Without prior context an overlapping window can summarize an occurrence again.

The PostgreSQL suite uses the real MCP handler, occurrence writes, and dispatcher, with an in-process callback receiver that verifies signatures independently. The mock calls the real read tool and checks the visible summary. This fixture records commit observation at the successful producer response and callback acceptance at the receiver response.

| Wake | Commit observed (UTC) | Callback accepted (UTC) | First tool read (UTC) | Summary completed (UTC) |
| --- | --- | --- | --- | --- |
| Normal | 05:48:54.849 | 05:48:54.900 | 05:48:54.921 | 05:48:55.002 |
| Burst of three | 05:48:55.201–05:48:55.488 | 05:48:55.543–05:48:55.587 | 05:48:55.604 | 05:48:55.823 |
| Empty | 05:48:55.928 | 05:48:55.976 | 05:48:55.996 | 05:48:56.409 |

These timestamps are from the November 24, 2026 mock run. Set `FACTORIZE_MOCK_DOT_TIMELINE=1` when running `test/mcp-events.postgres.test.ts` to print the per-occurrence timestamps. No live ChatGPT workspace or Dot was used.
