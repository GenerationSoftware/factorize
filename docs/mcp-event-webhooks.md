# MCP Event webhooks

Factorize exposes Event definitions over the authenticated `/mcp` endpoint. A definition's protocol name is `factorize.event.<definition-id>`. The catalog uses the current name and description. Subscriptions use the connected OAuth grant, require `triggers:read`, and receive newly recorded occurrences after activation. The webhook contains `occurrenceId` and `definitionId`. Use `read_event_occurrences` for the committed payload and its definition revision.

## Webhook egress

Deploy the image built from `services/mcp-webhook-egress` behind HTTPS. Set `MCP_EVENT_EGRESS_TOKEN` to the same randomly generated secret of at least 32 characters on the egress service and the Factorize Worker. Set the Worker's `MCP_EVENT_EGRESS_URL` to the service's HTTPS origin. Apply the repository's normal database migration before serving the new Worker code.

The Worker signs each serialized webhook body and calls the egress service's authenticated `POST /send`. The service validates all DNS answers on every outbound connection, dials a validated public address, and uses the original hostname for SNI and certificate verification. It returns only the HTTP status or a failure category, and a bounded challenge echo for verification. The service does not follow redirects or log request or response data. Subscription verification fails closed when egress is unconfigured. [MCP Events callback requirements](https://developers.openai.com/plugins/build/mcp-events), [Cloudflare production socket limitation](https://github.com/cloudflare/workerd/issues/6903)

Run `go test ./...` from `services/mcp-webhook-egress` to check TLS name verification using the pinned connection, redirect handling, and rejection of private destinations.

## Delivery and recovery

The occurrence and its outbox rows commit together. Subscription activation and occurrence insertion take the same transaction lock per definition. Each outbox row belongs to one activation generation, so refreshing an active subscription keeps its queued deliveries, while reactivating a stopped or expired one starts a new generation. Expiry defaults to 24 hours and is capped at seven days. A replaced secret is the primary signing key immediately, with a five-minute dual-signing window.

The Worker alarm claims due rows and checks current grant, owner, scope, subscription status, and expiry before sending. A retry after an interrupted or uncertain attempt uses the same occurrence ID and a fresh signature. Callback acceptance means the endpoint returned a successful HTTP status. In PostgreSQL, `app.mcp_event_deliveries` records the attempt count, status, last outcome, and HTTP status.

## Mocked Dot pilot

The mock saves the subscribed definition ID. For a wake with occurrence IDs, it calls `read_event_occurrences` once per ID. For an empty wake, it uses the saved ID and a recent overlapping `since` value, paging until `nextCursor` is null. The mock tracks already summarized occurrence IDs in its context. Without prior context an overlapping window can summarize an occurrence again.

The PostgreSQL suite uses the real MCP handler, occurrence writes, and dispatcher, with an in-process callback receiver that verifies signatures independently. The mock calls the real read tool and checks the visible summary. This fixture records commit observation at the successful producer response and callback acceptance at the receiver response.

| Wake | Commit observed (UTC) | Callback accepted (UTC) | First tool read (UTC) | Summary completed (UTC) |
| --- | --- | --- | --- | --- |
| Normal | 05:40:27.800 | 05:40:27.850 | 05:40:27.868 | 05:40:27.904 |
| Burst of three | 05:40:27.998–05:40:28.144 | 05:40:28.183–05:40:28.226 | 05:40:28.243 | 05:40:28.412 |
| Empty | 05:40:28.509 | 05:40:28.584 | 05:40:28.621 | 05:40:29.109 |

These timestamps are from the November 24, 2026 mock run. Set `FACTORIZE_MOCK_DOT_TIMELINE=1` when running `test/mcp-events.postgres.test.ts` to print the per-occurrence timestamps. No live ChatGPT workspace or Dot was used.
