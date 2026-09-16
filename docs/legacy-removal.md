# Legacy removal rollout

Generic custom webhooks and the legacy Flow product are no longer accepted or exposed. Only Jobs and authenticated Linear, GitHub, and signed Cloudflare Tail triggers are supported.

Deploy the application before removing stored legacy data so old endpoints fail closed with `404` and no unsupported record can launch work. Existing `pipes`, Flow event, custom-source, and legacy delivery rows are inert after deployment and may be deleted during a maintenance window. Preserve `jobs`, `triggers`, `invocations`, `job_runs`, and execution/run records associated with a Job ID.

Before deletion, export any audit data that must be retained. There is intentionally no automatic bridge from a Flow or generic custom webhook to a Job because trigger provenance and authentication cannot be inferred safely. Recreate wanted automation as a Job with an authenticated provider trigger.
