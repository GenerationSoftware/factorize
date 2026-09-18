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
record. `run_transcripts` stores only scrubbed plaintext and provides the GIN
full-text index used by PostgreSQL search.
