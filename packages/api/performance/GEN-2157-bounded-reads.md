# Bounded-read migration measurements

Local repeatable evidence, October 9, 2026; Node 24.21.0, PostgreSQL 16. Run
`AUTH_TEST_DATABASE_URL=<disposable-local-admin-url> npm run benchmark:migration --workspace=factorize`.
The runner creates and removes isolated databases and writes `gen-2157-bounded-reads.json`.
Five measured samples follow one warmup. Calls include service authorization. Query counts include
membership lookup. Request counts are equivalent API operations, **not measured browser navigations**.
No production latency or throughput claim is made. Local timings include pool/crypto overhead and
are sensitive to concurrent VM work.

| Representation, large fixture | Queries | JSON bytes | Median ms |
| --- | ---: | ---: | ---: |
| Legacy jobs array | 4 | 10,347,734 | 716.52 |
| Summary jobs, 30 items | 2 | 8,583 | 4.93 |
| Individual job | 4 | 50,925 | 14.91 |
| Job + legacy all-jobs editor reads | 8 | 10,398,662 | 705.19 |
| Job + bounded selector reads | 6 | 54,141 | 16.30 |
| Legacy full run detail poll | 6 | 151,363 | 14.98 |
| Lightweight run status poll | 2 | 360 | 4.12 |
| Revision-bound trace page, 100 events | 2 | 59,670 | 5.44 |

The large workspace has 205 jobs with 50,000-character prompts, 50,000-character invocation
context and 20,000 trace events. The raw artifact also records the ten-job fixture and timing ranges.
The editor comparison measures available API reads; the React editor is not yet implemented.
A full job-detail response remains necessary for an editor and intentionally retains its prompt.
The summary query never selects encrypted prompts/configuration and performs one batch statistics
aggregation for the selected page. The selector skips statistics. The run-status query never
selects/decrypts prompts or assembles invocation context, activity, diagnostics or artifacts.

The initial React trace view renders one page of at most 100 events. This bounds its DOM but does
not establish virtualized long-trace/continuous-scroll parity, which remains a cutover gate.
Browser rendering/frame/focus/selection measurements and production request/header/cache evidence
remain outstanding. The compiled-browser slice verifies actual API/DB navigation and invocation,
but routes requests through the test interceptor, not Cloudflare's production hosting layer.
