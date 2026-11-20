-- Do not reinterpret already accepted guest-agent configurations as hosted Pi
-- launches. Their model credential and environment choices require an explicit
-- new admission; preserve the original inputs/configuration and cancellation.
WITH pending AS (
 UPDATE app.runs SET state='blocked',failure_source=NULL,failure_code='managed_agent_cutover_required',
 failure_reason='This accepted run used a retired guest agent. Its original inputs and configuration are preserved. Configure hosted Pi model/VM permissions, then cancel this blocked run and submit a new run; it will not launch a legacy harness or silently substitute credentials.',updated_at=now()
 WHERE state IN ('queued','reserved','starting') AND execution_handle IS NULL
 AND execution_backend_kind<>'hosted-pi' AND coalesce(execution_config->>'executionType','agent')<>'code'
 RETURNING tenant_id,id
), blocked AS (
 UPDATE app.trigger_runs r SET state='blocked',launch_lease_expires_at=NULL,next_poll_at=NULL,updated_at=now()
 FROM pending p WHERE r.tenant_id=p.tenant_id AND r.id=p.id RETURNING r.tenant_id,r.id
)
INSERT INTO app.run_activity(tenant_id,id,run_id,action,detail)
SELECT tenant_id,gen_random_uuid(),id,'managed_agent_cutover_required','Original guest-agent admission preserved without launching a retired harness. Cancel and submit a new hosted Pi run after configuring its model and permissions.' FROM blocked;
INSERT INTO app.schema_migrations(version) VALUES('0079_hosted_pi_pending_cutover') ON CONFLICT DO NOTHING;
