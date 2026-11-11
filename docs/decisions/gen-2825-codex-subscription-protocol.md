# GEN-2825: Codex subscription protocol proof

**Decision:** a narrow credential proxy can translate a local OpenAI Responses
provider into the Codex ChatGPT subscription protocol observed in the pinned
Codex source. Keep OAuth credentials and refresh state in the proxy. Give Codex
only the proxy's local credential. This is protocol feasibility evidence, not
production account management or a live subscription compatibility claim.

## Evidence and version

This proof targets **Codex CLI `@openai/codex` 0.167.1**, published on npm and
tagged in OpenAI's source as `rust-v0.167.1` at commit
[`0a94398fa60c4fac0e7659e4213a0a36e613dd46`](https://github.com/openai/codex/commit/0a94398fa60c4fac0e7659e4213a0a36e613dd46).
The official [Codex authentication guide](https://developers.openai.com/codex/auth)
documents signing in with ChatGPT and using a supported ChatGPT plan. The
official [Codex CLI README](https://github.com/openai/codex/blob/rust-v0.167.1/README.md)
also describes subscription sign-in.

The tagged source provides the wire details absent from the user-facing guide:

- Device authorization starts at `POST https://auth.openai.com/api/accounts/deviceauth/usercode`, polls `POST .../deviceauth/token`, then exchanges the code at `POST https://auth.openai.com/oauth/token` with the device callback URI and PKCE verifier. The device-code flow has a 15 minute bound.
- The token identity object at `https://api.openai.com/auth` contains `chatgpt_account_id`, which binds refresh and inference to one ChatGPT account. Codex sends `Authorization: Bearer <access token>` and `chatgpt-account-id: <account id>` upstream.
- The Codex Responses origin is `https://chatgpt.com/backend-api/codex`; model discovery uses its `/models` endpoint and inference uses `/responses`. Inference is streamed as server-sent events. The proxy must translate model discovery into the local provider's `/v1/models` response shape and relay `/v1/responses` streams unchanged.
- Refresh uses `POST https://auth.openai.com/oauth/token` with `grant_type=refresh_token`; Codex retains and refreshes the rotated token pair. This proof assigns that ownership to the proxy instead.

Source references: [`device_code_auth.rs`](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/login/src/device_code_auth.rs), [`server.rs`](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/login/src/server.rs), [`auth/manager.rs`](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/login/src/auth/manager.rs), [`model_provider_info`](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/model-provider-info/src/lib.rs), and [`models_endpoint.rs`](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/model-provider/src/models_endpoint.rs). These are implementation details, not a public OAuth or subscription API contract.

## Proof boundary

`packages/api/src/codex-subscription-proof.ts` owns the synthetic account tokens
and translates device login, refresh, model discovery, and streaming requests.
The local client authenticates with a separate proxy key; neither account token
nor account identity is present in responses returned to that client. This
module is isolated and does not execute Codex or any other agent workload. The
fake authorization, token, and model server in
`packages/api/test/codex-subscription-proof.test.ts` checks successful login,
expiry and refresh, account separation, upstream URL/headers, model discovery,
SSE relay, and token non-disclosure.

Focused command: `npm test --workspace=factorize -- test/codex-subscription-proof.test.ts`.

The fixture uses synthetic tokens and local ephemeral HTTP only. **It does not
prove compatibility with a live ChatGPT subscription.** No live account or
credentials were available for this run, so the real-account gate remains.

## Unsupported assumptions and constraints

- OpenAI's subscription OAuth and `/backend-api/codex` routes are private
  implementation details. Their behavior, availability, terms, and response
  schemas can change without notice; no public compatibility guarantee was
  found. Pin and re-audit Codex before widening support beyond 0.167.1.
- The proof assumes the subscription continues to permit proxy-mediated use
  and that the proxy can securely retain/rotate tokens. The fixtures do not
  establish either policy or live service behavior.
- A local custom provider must use the Codex Responses wire format and model
  metadata expected by Codex. Generic OpenAI-compatible chat completions are
  insufficient. Account tokens must be confined to the credential proxy.
- Refresh rotation races, durable encrypted persistence, revocation, multiple
  concurrent requests, browser account management, and production deployment
  are outside this proof and remain separate work.

## Optional bounded live smoke

Prerequisites: a running authorized Factorize proxy with a named ChatGPT account
already connected, a proxy-local key (not an OpenAI or ChatGPT token), the
proxy's local `/v1` URL, and a model exposed by that proxy. This command invokes
Codex against the proxy; it does not log in to ChatGPT on the agent VM. It is
opt-in, takes at most five minutes, and is not part of `npm test`:

```sh
set -eu
test -n "${CODEX_PROXY_URL:-}"          # e.g. http://127.0.0.1:8787
test -n "${CODEX_PROXY_LOCAL_KEY:-}"    # proxy-local credential only
test -n "${CODEX_PROXY_MODEL:-}"
CODEX_HOME="$(mktemp -d)"
trap 'rm -rf "$CODEX_HOME"' EXIT
CODEX_HOME="$CODEX_HOME" OPENAI_API_KEY="$CODEX_PROXY_LOCAL_KEY" \
  timeout --signal=TERM --kill-after=5s 300s \
  npx --yes @openai/codex@0.167.1 \
    --config 'model_provider="factorize-proof"' \
    --config 'model_providers.factorize-proof.name="Factorize subscription proxy"' \
    --config "model_providers.factorize-proof.base_url=\"$CODEX_PROXY_URL/v1\"" \
    --config 'model_providers.factorize-proof.env_key="OPENAI_API_KEY"' \
    --model "$CODEX_PROXY_MODEL" exec --skip-git-repo-check \
    'Reply with exactly CODEX_PROXY_SMOKE_OK'
```

Passing this command would establish compatibility only for the configured live
proxy/account/model at that time. A fixture pass is not a substitute for this
gate.
