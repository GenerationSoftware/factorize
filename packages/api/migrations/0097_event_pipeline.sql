-- Durable output events are separate from trigger inputs. This migration is
-- additive: existing providers and input definitions remain in place while
-- dispatch moves to the event pipeline.
CREATE TABLE app.event_definitions (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  description text NOT NULL DEFAULT '',
  current_revision integer NOT NULL CHECK (current_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,name)
);

CREATE TABLE app.event_definition_revisions (
  tenant_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  payload_schema jsonb NOT NULL DEFAULT '{"type":"object"}',
  subscription_filters jsonb NOT NULL DEFAULT '{"type":"object"}',
  publish_policy text NOT NULL CHECK (publish_policy IN ('trigger_only','session')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,definition_id,revision),
  FOREIGN KEY (tenant_id,definition_id) REFERENCES app.event_definitions(tenant_id,id) ON DELETE CASCADE
);

ALTER TABLE app.triggers ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE app.triggers ADD COLUMN output_definition_id uuid;
ALTER TABLE app.triggers ADD COLUMN output_definition_revision integer;
ALTER TABLE app.triggers ADD COLUMN output_payload_mapping jsonb NOT NULL DEFAULT '{"mode":"identity"}';

INSERT INTO app.event_definitions(tenant_id,id,name,description,current_revision,created_at,updated_at)
SELECT t.tenant_id,gen_random_uuid(),'trigger.' || left(regexp_replace(lower(t.slug),'[^a-z0-9_.-]','-','g'),100) || '.' || left(replace(t.id::text,'-',''),8),'Output event for ' || t.name,1,t.created_at,t.updated_at
FROM app.triggers t;

INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema,publish_policy,created_at)
SELECT d.tenant_id,d.id,1,'{"type":"object"}', 'trigger_only',d.created_at
FROM app.event_definitions d
WHERE d.name LIKE 'trigger.%';

UPDATE app.triggers t
SET output_definition_id=d.id,output_definition_revision=1
FROM app.event_definitions d
WHERE d.tenant_id=t.tenant_id AND d.name='trigger.' || left(regexp_replace(lower(t.slug),'[^a-z0-9_.-]','-','g'),100) || '.' || left(replace(t.id::text,'-',''),8);

ALTER TABLE app.triggers ADD CONSTRAINT triggers_output_definition_revision_fk
  FOREIGN KEY (tenant_id,output_definition_id,output_definition_revision)
  REFERENCES app.event_definition_revisions(tenant_id,definition_id,revision);

CREATE OR REPLACE FUNCTION app.seed_trigger_event_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition_id uuid;
BEGIN
  IF NEW.output_definition_id IS NOT NULL THEN RETURN NEW; END IF;
  definition_id := gen_random_uuid();
  INSERT INTO app.event_definitions(tenant_id,id,name,description,current_revision)
    VALUES(NEW.tenant_id,definition_id,'trigger.' || left(regexp_replace(lower(NEW.slug),'[^a-z0-9_.-]','-','g'),100) || '.' || left(replace(NEW.id::text,'-',''),8),'Output event for ' || NEW.name,1);
  INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema,publish_policy)
    VALUES(NEW.tenant_id,definition_id,1,'{"type":"object"}','trigger_only');
  UPDATE app.triggers SET output_definition_id=definition_id,output_definition_revision=1 WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER triggers_seed_event_definition AFTER INSERT ON app.triggers
  FOR EACH ROW EXECUTE FUNCTION app.seed_trigger_event_definition();

WITH duplicates AS (
  SELECT ctid,row_number() OVER (PARTITION BY tenant_id,event_id,delivery_id ORDER BY next_attempt_at,id) AS sequence
  FROM app.pending_verifications
)
DELETE FROM app.pending_verifications p USING duplicates d WHERE p.ctid=d.ctid AND d.sequence>1;
CREATE UNIQUE INDEX pending_verifications_event_delivery
  ON app.pending_verifications(tenant_id,event_id,delivery_id);

-- Run lifecycle and idle events no longer produce executor work.
ALTER TABLE app.events DROP CONSTRAINT IF EXISTS events_kind_check;
DELETE FROM app.events WHERE kind IN ('triggerLifecycle','triggerIdle');
ALTER TABLE app.events ADD CONSTRAINT events_kind_check CHECK (kind IN ('manual','schedule','webhook'));

CREATE TABLE app.event_occurrences (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  definition_id uuid NOT NULL,
  definition_revision integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  producer_identity jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  source_identity text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source_identity,idempotency_key),
  FOREIGN KEY (tenant_id,definition_id,definition_revision)
    REFERENCES app.event_definition_revisions(tenant_id,definition_id,revision) ON DELETE CASCADE
);
CREATE INDEX event_occurrences_by_definition ON app.event_occurrences(tenant_id,definition_id,occurred_at DESC,id DESC);

CREATE TABLE app.trigger_matches (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  trigger_id uuid NOT NULL,
  trigger_revision integer NOT NULL,
  source_identity text NOT NULL,
  deduplication_key text NOT NULL,
  evidence jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('matched','pending','excluded','failed')),
  pending_reason text,
  occurrence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,trigger_id,trigger_revision,source_identity,deduplication_key),
  FOREIGN KEY (tenant_id,trigger_id) REFERENCES app.triggers(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,occurrence_id) REFERENCES app.event_occurrences(tenant_id,id) ON DELETE SET NULL,
  CHECK ((outcome='pending' AND pending_reason IS NOT NULL) OR outcome<>'pending')
);
CREATE INDEX trigger_matches_recent ON app.trigger_matches(tenant_id,trigger_id,created_at DESC);

INSERT INTO app.schema_migrations(version) VALUES ('0097_event_pipeline') ON CONFLICT DO NOTHING;
