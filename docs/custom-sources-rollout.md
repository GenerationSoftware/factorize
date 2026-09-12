# Custom source rollout

Custom sources remain disabled unless `CUSTOM_SOURCES_ENABLED=true`. Before enabling them:

1. Confirm the `CUSTOM_HANDLER_LOADER` Dynamic Worker Loader binding is available in production.
2. Run production probes that attempt HTTP and TCP egress, service binding access, cache persistence, and reads of secrets and every supported binding. Dynamic handlers receive an empty environment and `globalOutbound: null`; enable only when every access fails.
3. Enable one internal tenant and monitor invocation failures, CPU termination, and overflow drops.

Custom triggers are intentionally lossy once a flow has 100 pending jobs. Valid signed provider deliveries are still acknowledged to prevent retry storms.
