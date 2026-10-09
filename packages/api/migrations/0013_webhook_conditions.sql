-- GEN-2158: explicit reviewed cutover. The deploy must restore only after
-- the conditions Worker is deployed and verified. Unknown handlers abort.
LOCK TABLE app.triggers IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE app.webhook_conditions_cutover (
  tenant_id uuid NOT NULL, trigger_id uuid NOT NULL, was_enabled boolean NOT NULL,
  conditions jsonb NOT NULL, restored_at timestamptz,
  PRIMARY KEY (tenant_id, trigger_id),
  FOREIGN KEY (tenant_id, trigger_id) REFERENCES app.triggers(tenant_id, id) ON DELETE CASCADE
);
DO $cutover$
DECLARE legacy record;
BEGIN
  FOR legacy IN SELECT * FROM app.triggers WHERE config ? 'handlerCode' LOOP
    IF legacy.job_id <> '0bf608ba-e2f3-4c75-ac1d-42971bcd1cc4'::uuid
      OR legacy.slug <> 'trigger-2' OR legacy.kind <> 'webhook'
      OR legacy.config->>'provider' IS DISTINCT FROM 'github'
      OR legacy.config->>'event' IS DISTINCT FROM 'check_suite'
      OR legacy.config->>'action' IS DISTINCT FROM 'completed'
      OR legacy.config->>'handlerCode' IS DISTINCT FROM $reviewed$function handler(webhook) {
  const suite = webhook.check_suite;
  if (webhook.action !== "completed" || !suite) return true;
  const branch = typeof suite.head_branch === "string" ? suite.head_branch : "";
  if (suite.conclusion === "success" && branch.startsWith("gh-readonly-queue/")) return false;
  if (suite.conclusion === "success" && branch === "main" && webhook.sender?.login === "github-merge-queue[bot]") return false;
  if (suite.conclusion === "skipped" && suite.app?.slug === "mintlify") return false;
  return true;
}$reviewed$
      OR legacy.config ? 'conditions' THEN
      RAISE EXCEPTION 'GEN-2158 migration blocker: unreviewed handler on trigger %', legacy.id;
    END IF;
    INSERT INTO app.webhook_conditions_cutover(tenant_id,trigger_id,was_enabled,conditions)
    VALUES (legacy.tenant_id,legacy.id,legacy.enabled,$conditions${"not": {"any": [{"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "success"}, {"fact": "webhook", "path": "$.check_suite.head_branch", "operator": "startsWith", "value": "gh-readonly-queue/"}]}, {"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "success"}, {"fact": "webhook", "path": "$.check_suite.head_branch", "operator": "equal", "value": "main"}, {"fact": "webhook", "path": "$.sender.login", "operator": "equal", "value": "github-merge-queue[bot]"}]}, {"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "skipped"}, {"fact": "webhook", "path": "$.check_suite.app.slug", "operator": "equal", "value": "mintlify"}]}]}}$conditions$::jsonb);
    UPDATE app.triggers SET enabled=false,
      config=(config-'handlerCode') || jsonb_build_object('conditions',$conditions${"not": {"any": [{"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "success"}, {"fact": "webhook", "path": "$.check_suite.head_branch", "operator": "startsWith", "value": "gh-readonly-queue/"}]}, {"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "success"}, {"fact": "webhook", "path": "$.check_suite.head_branch", "operator": "equal", "value": "main"}, {"fact": "webhook", "path": "$.sender.login", "operator": "equal", "value": "github-merge-queue[bot]"}]}, {"all": [{"fact": "webhook", "path": "$.check_suite.conclusion", "operator": "equal", "value": "skipped"}, {"fact": "webhook", "path": "$.check_suite.app.slug", "operator": "equal", "value": "mintlify"}]}]}}$conditions$::jsonb), updated_at=now()
      WHERE tenant_id=legacy.tenant_id AND id=legacy.id;
    UPDATE app.jobs SET updated_at=now() WHERE tenant_id=legacy.tenant_id AND id=legacy.job_id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM app.triggers WHERE config ? 'handlerCode') THEN
    RAISE EXCEPTION 'GEN-2158: stored handlers remain';
  END IF;
END $cutover$;
-- Prevent the previous Worker (or any direct writer) reintroducing a handler.
ALTER TABLE app.triggers ADD CONSTRAINT no_webhook_handler_code CHECK (NOT (config ? 'handlerCode'));
