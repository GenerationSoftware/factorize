# Factorize Clients, VMs, and Apps

Implement the items below in order, from top to bottom. Work on one item until all its acceptance criteria are met and checked, then move to the next item. Check a box only after verifying it with the available VM shell, repository tests, browser tests, or GitHub tools. Record the verification command and result alongside each completed section. Fix recoverable failures and rerun the relevant checks. Do not stop until every criterion is complete. If access or infrastructure genuinely blocks progress, record the exact failed operation and leave the affected boxes open.

Work in the exe.dev checkout on `codex/clients-vms-apps`. Follow `AGENTS.md` and the current contracts in this checkout. Use fixtures and the isolated local validation database. Do not run tests against production.

## 0. Verify the development environment

- [x] Boot the VM from the pinned Factorize validation runner image.
- [x] Clone `GenerationSoftware/factorize` and verify write access from the guest by pushing the feature branch and reading its ref back from GitHub.
- [x] Verify Node 24.12.0 and npm 11.19.0. Run the image smoke check for PostgreSQL and Chromium and run `npm ci`.

Verified on `factorize-clients-vms-apps`. The image smoke script passed with the image-provided `/etc/environment` loaded for the non-login guest process. PostgreSQL authenticated on loopback, Chromium launched as `exedev`, and `npm ci` succeeded.

## 1. Display existing VM attachments

- [x] Add a **VMs** dashboard navigation entry. Show VMs with active Factorize proxy access, with machine name or ID, provider, access status, and links to the authorizing run or client connection.
- [x] Add **VMs** beside **Trace** and **Info** on run details. Show current and historical run VM access from retained binding records, including terminated runs where a record exists.
- [x] Make the same tenant-scoped read model support current and historical client VM grants for the Clients screen in item 2. Record attachment source, expiry and revocation where available. Use persisted access eligibility without polling provider power state or changing how VMs are granted or provisioned.
- [x] Verify with application tests that active and historical records appear in the appropriate views, unrelated machines are excluded, and another tenant cannot read them. Verify navigation and links in Chromium, including the empty state.

Verified with `vitest run test/vm-attachments.postgres.test.ts` (2 passed), `npm run build:app`, the focused Chromium inventory test (1 passed), and `git diff --check`.

## 2. Move Authorized Clients to Clients

- [ ] Add **Clients** to the dashboard navigation and redirect the old Authorized Clients settings URL. Show one row per MCP connection and put the OAuth app name in its own column. Keep API tokens and registered sign-in app connections outside this list.
- [ ] A connection detail shows its active and historical VM grants, including access state. Verify two connections with the same OAuth client ID keep separate VM histories and can be revoked independently.
- [ ] **Edit permissions** offers the team default via a preset selector. Reuse the repository's team permission default where available and the existing consent and scope definitions. Applying the default cannot grant additional scopes without consent. Keep grants as-is until an edit. Where no applicable default exists, show its unavailable state and preserve the grant.
- [ ] Verify that narrowing permissions takes effect for outstanding requests and any dependent VM access that requires removed permissions. Verify the existing per-connection and compatibility client-wide revoke operations still work.

## 3. Register and manage apps

- [ ] Add **Apps** to the dashboard navigation with **Connected apps** and **Registered apps** views. Use **Registered apps** for team-owned registrations. The connected view consumes sign-in grants from item 4, with empty-state and fixture coverage in this item.
- [ ] Team owners can register, list, inspect, edit, and disable confidential server-side apps and configure exact redirect URLs. Apps are team-only by default and support an opt-in **Available to everyone** setting.
- [ ] Add dedicated app-management authorization for MCP. Verify a scoped MCP caller can manage non-secret fields for its team and an unscoped or cross-team caller is rejected.
- [ ] Verify client secret creation and rotation are available only to an authorized browser session. Return newly issued secrets once, store a verifier, and never expose secret material in MCP, registration reads, logs, or test output.

## 4. Implement Sign in with Factorize

- [ ] Implement OpenID Connect for confidential server-side applications with code flow, PKCE S256, registered redirect URLs, client authentication, discovery, JWKS, and signed ID tokens. Verify a sample server app can perform sign-in and validate its ID token.
- [ ] The built-in default is minimal identity with a stable subject. An app can explicitly ask for the current Factorize API scopes and receives only scopes expressly authorized by the user. Verify identity-only tokens cannot exercise Factorize application permissions and an approved scope can access its API operation.
- [ ] Verify private apps reject other teams, public apps can accept other teams, and granted API access applies to the authorizing user's team. Cover invalid redirect, client secret, PKCE, and code reuse, and handling of scope and token audience.
- [ ] **Connected apps** displays authorized sign-in app connections and supports revoking each connection. Verify revocation, app disabling, and secret rotation enforce their respective token and authentication effects. Verify existing MCP OAuth and device-code flows still work.

## 5. Finish validation and open the PR

- [ ] New JSON application operations use the shared documented `/api/v1` contract. Register routes in `protected-api.ts`, update OpenAPI, regenerate the API client, and verify authorization, validation and contract tests. Keep OAuth and OIDC wire-protocol routes in their protocol namespaces.
- [ ] Document server app sign-in setup, team and public visibility, scopes, client secret rotation, and revocation. Preserve REST and MCP full/detail/trace responses and conditional-write omission compatibility.
- [ ] Run `npm run check:boundaries`, `git diff --check`, and `npm run test:local` on the final code. The last command runs the complete root `npm test` suite with the isolated database. Record results and check every criterion supported by verification.
- [ ] Commit and push the completed branch from the VM. Open a pull request against `main`, verify its URL and head, and include validation results. Update the final checklist state on the branch.
