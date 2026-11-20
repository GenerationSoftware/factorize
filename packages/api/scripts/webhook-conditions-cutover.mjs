export async function restoreConditionsCutover(client) {
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE app.events IN SHARE ROW EXCLUSIVE MODE");
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM app.events WHERE config ? 'handlerCode') THEN RAISE EXCEPTION 'Stored handlers remain'; END IF;
      IF EXISTS (SELECT 1 FROM app.webhook_conditions_cutover c JOIN app.events t ON t.tenant_id=c.tenant_id AND t.id=c.event_id WHERE c.restored_at IS NULL AND (t.enabled OR t.config->'conditions' IS DISTINCT FROM c.conditions)) THEN RAISE EXCEPTION 'Cutover configuration changed; review before restoring'; END IF;
    END $$`);
    const result = await client.query(`UPDATE app.events t SET enabled=c.was_enabled,updated_at=now() FROM app.webhook_conditions_cutover c WHERE t.tenant_id=c.tenant_id AND t.id=c.event_id AND c.restored_at IS NULL RETURNING t.id,t.enabled`);
    await client.query(`UPDATE app.triggers j SET updated_at=now() WHERE EXISTS (SELECT 1 FROM app.events t JOIN app.webhook_conditions_cutover c ON c.tenant_id=t.tenant_id AND c.event_id=t.id WHERE t.tenant_id=j.tenant_id AND t.trigger_id=j.id AND c.restored_at IS NULL)`);
    await client.query("UPDATE app.webhook_conditions_cutover SET restored_at=now() WHERE restored_at IS NULL");
    await client.query("COMMIT");
    return result.rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
