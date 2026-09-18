# PostgreSQL migrations

These reviewed SQL migrations run outside Worker request handling. Apply them
with a schema-owner connection:

```bash
DATABASE_URL=postgresql://... npm run db:migrate --workspace=factorize
DATABASE_URL=postgresql://... npm run db:verify --workspace=factorize
```

The runner serializes concurrent deploys with a PostgreSQL advisory lock and
records each applied filename in `app.schema_migrations`. Verify migrations on
an isolated Neon branch before applying them to production. The application
must connect through Hyperdrive with a least-privilege role; do not commit its
connection string or expose it as a Worker variable.

The initial schema deliberately excludes the inert legacy `pipes`,
`deliveries`, and `flow_events` tables. Every application-owned relationship
uses a tenant-qualified key so a child row cannot reference another tenant's
record. Native sessions live in object storage. `run_artifacts` records exact
keys and checksums, while `run_trace_events` is the bounded projection used by
the cursor-paginated UI and PostgreSQL search.

The destructive artifact cutover is `0002`; `0003` completes runtime queue
ownership by binding deferred GitHub verification to an exact trigger.
