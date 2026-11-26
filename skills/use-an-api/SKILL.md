---
name: use-an-api
description: Use an API the user connected and authorized in Factorize.
---

1. Call `get_api_reflection` and choose the correct granted integration.
2. Use `request_api` with its ID and a relative path. Never ask for or pass
   provider credentials. Start with a read-only test and confirm before writes
   the user did not request.
3. Poll `get_api_operation` for queued calls; read only the needed response.

Follow the [API recipe](https://docs.factorize.sh/work/use-an-api) and
[MCP reference](https://docs.factorize.sh/mcp/tools#integration-apis).
