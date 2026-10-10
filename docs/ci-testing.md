# CI test lanes

Required pull-request and merge-queue CI is split into independent backend and
browser jobs. The `Test and validate Workers` aggregate check keeps the existing
required-check name while ensuring a browser failure cannot prevent backend
validation. Pull-request runs cancel only an older run for the same PR; merge
queue runs use a separate, non-cancelable concurrency group.

Screenshot regressions and the 20,000-event trace stress case are intentionally
outside required CI. Run **Optional visual regressions** from the Actions tab.
Set `Update checked-in Playwright visual baselines` when reviewing a baseline
update; locally, the equivalent commands are:

```sh
npm ci
npm run build --workspace=factorize-app
npx playwright install chromium
npm run test:visual --workspace=factorize-app
npm run test:visual --workspace=factorize-app -- --update-snapshots
FACTORIZE_STRESS=1 npm test --workspace=factorize-app
```

The optional workflow uploads Playwright result and report artifacts on
failure. Required functional browser coverage remains in
`packages/app/test/functional/critical.spec.mjs` and uses representative
desktop/mobile behavior, with one focused accessibility scan rather than a
scan for every presentation permutation.

## Timing record

The analysis baseline was a successful CI run on 2026-10-10 (run
`38069398135`):

| Lane | Baseline wall time | Baseline runner work |
| --- | ---: | ---: |
| Visual suite (41 tests, one worker) | 61s | 61s |
| API unit/integration (358 tests) | 26s | 26s |
| Functional browser (42 tests) | 21s | 21s |
| Chromium installation | 21s | 21s |
| Compiled app/API/PostgreSQL integration | 8s | 8s |
| Worker runtime checks | ~9s | ~9s |
| Successful required job | 3m10s–3m22s | recorded in run |

After this change, compare successful runs by the `Backend checks`, `Required
browser checks`, and `Test and validate Workers` job summaries, and record the
optional workflow separately. Wall time is the aggregate job duration; runner
work is the sum of job durations, so the two measures must not be added as if
they were interchangeable.
