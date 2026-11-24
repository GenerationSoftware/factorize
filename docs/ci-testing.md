# CI test lanes

`npm test` runs all required validation. `npm run check` is an alias. The
validation runner builds the frontend once and runs independent checks in
parallel, with elapsed times in the summary. Checks that consume the app
bundle wait for that build. Contract drift checks read the checked-in
generated files. Run `npm run generate` when changing their sources.

GitHub Actions runs static checks alongside the shared app build. After the
build, two API test shards balanced by observed test costs, the browser suite,
and the Worker runtime suite
fan out to their own runners. Each database job migrates an empty loopback
PostgreSQL database once. Tests clone that database and drop their own
fixtures on cleanup. The browser job installs Chromium and shares one browser
and one static app server per Playwright worker. The Worker runtime suite
shares one Wrangler instance across its hosting and OAuth tests, with a
separate tenant for each case. The OAuth suite exercises the first Event
workflow through the public MCP and REST boundaries.

The `Test and validate Workers` aggregate check keeps the existing
required-check name and requires every job to pass. Pull-request runs cancel
only an older run for the same PR. Merge queue runs have a separate,
non-cancelable concurrency group.

## Local validation

Use the pinned [validation runner image](factorize-validation-runner.md), then
run `npm ci` and `npm run test:local`. Local validation migrates the
disposable template database, then runs `npm test`. Keep the template free of
other connections while tests are cloning it.

The local runner defaults to one independent check per available CPU, up to
four. Vitest allows one additional worker for PostgreSQL waits, also capped
at four. Set `FACTORIZE_VALIDATION_JOBS` and
`FACTORIZE_VITEST_WORKERS` to positive integers to compare scheduling on a
particular machine.

- `npm run test:api` runs the API suite. Set `FACTORIZE_API_SHARD=1/2` or `2/2`
  to run a CI shard.
- `npm run test:browser` runs the Playwright suite.
- `npm run test:worker` runs the Worker runtime suite and Wrangler dry runs.
- `npm run test:static` runs type, contract, and other static checks.
- `npm run test:proxy` runs the portable harness and two focused API test files.
  The complete suite runs those API files through Vitest once.

Database lanes use `AUTH_TEST_DATABASE_URL` from `npm run bootstrap:test`.
The `--prebuilt` option is for CI jobs consuming the bundle from the same
checkout. Bun is pinned in the npm lockfile and used for type checks. CI also
runs the repository's reference TypeScript compiler during the comparison
period. Set `FACTORIZE_COMPARE_TYPECHECK=1` to run both locally.

The old screenshot and trace stress workflow was retired with the associated
features. Required browser coverage lives in `packages/app/test/functional`.
