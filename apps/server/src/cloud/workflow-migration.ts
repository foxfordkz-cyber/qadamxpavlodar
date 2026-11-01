// Append-only migration 3: one canonical registry, workflow relationships and immutable approvals.
export const migration3 = `
ALTER TABLE gp_cloud.documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE gp_cloud.documents ADD CHECK(kind IN ('plant','site','catalog','context','resource','care_policy','evidence','visualization','plan'));
INSERT INTO gp_cloud.documents(kind,id,data,version)
 SELECT kind,id,data,version FROM gp_cloud.planning_documents WHERE kind IN ('site','context','catalog');
ALTER TABLE gp_cloud.zone_contexts DROP CONSTRAINT zone_contexts_site_kind_site_id_fkey;
ALTER TABLE gp_cloud.zone_contexts ADD FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.documents(kind,id);
ALTER TABLE gp_cloud.analysis_snapshots DROP CONSTRAINT analysis_snapshots_site_kind_site_id_fkey;
ALTER TABLE gp_cloud.analysis_snapshots ADD FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.documents(kind,id);
INSERT INTO gp_cloud.history(id,entity_type,entity_id,actor_id,action,before_json,after_json,created_at)
 SELECT id,entity_kind,entity_id,actor_id,action,before_json,after_json,created_at FROM gp_cloud.planning_history WHERE entity_kind IN ('site','context','catalog');
DELETE FROM gp_cloud.planning_history WHERE entity_kind IN ('site','context','catalog');
DELETE FROM gp_cloud.planning_documents WHERE kind IN ('site','context','catalog');
ALTER TABLE gp_cloud.planning_documents DROP CONSTRAINT planning_documents_kind_check;
ALTER TABLE gp_cloud.planning_documents ADD CHECK(kind IN ('species','settings','layer'));
CREATE TABLE gp_cloud.municipal_roles(user_id text PRIMARY KEY REFERENCES gp_cloud.users(id),role text NOT NULL CHECK(role='viewer'));
CREATE TABLE gp_cloud.profiles (user_id TEXT PRIMARY KEY REFERENCES gp_cloud.users(id), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), version INTEGER NOT NULL);
CREATE TABLE gp_cloud.crews (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, foreman_id TEXT NOT NULL REFERENCES gp_cloud.users(id),
 active INTEGER NOT NULL CHECK(active IN (0,1)), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), version INTEGER NOT NULL CHECK(version>0)
);
CREATE TABLE gp_cloud.memberships (
 id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES gp_cloud.crews(id), user_id TEXT NOT NULL REFERENCES gp_cloud.users(id),
 valid_from TEXT NOT NULL, valid_until TEXT, active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE UNIQUE INDEX one_active_crew ON gp_cloud.memberships(user_id) WHERE active=1;
CREATE TABLE gp_cloud.designs (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('draft','submitted','changes_requested','approved')),
 version INTEGER NOT NULL CHECK(version>0), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE TABLE gp_cloud.design_revisions (
 design_id TEXT NOT NULL REFERENCES gp_cloud.designs(id), revision INTEGER NOT NULL, status TEXT NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), PRIMARY KEY(design_id,revision)
);
CREATE TABLE gp_cloud.tasks (
 id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','assigned','in_progress','submitted','verified')),
 crew_id TEXT REFERENCES gp_cloud.crews(id), design_id TEXT REFERENCES gp_cloud.designs(id), design_revision INTEGER,
 version INTEGER NOT NULL CHECK(version>0), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 UNIQUE(design_id,design_revision)
);
CREATE TABLE gp_cloud.assignments (
 task_id TEXT NOT NULL REFERENCES gp_cloud.tasks(id), user_id TEXT NOT NULL REFERENCES gp_cloud.users(id), PRIMARY KEY(task_id,user_id)
);
CREATE TABLE gp_cloud.reports (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES gp_cloud.tasks(id), revision INTEGER NOT NULL,
 author_id TEXT NOT NULL REFERENCES gp_cloud.users(id), status TEXT NOT NULL CHECK(status IN ('pending','accepted','changes_requested')),
 version INTEGER NOT NULL CHECK(version>0), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), UNIQUE(task_id,revision)
);
CREATE TABLE gp_cloud.report_drafts (task_id TEXT PRIMARY KEY REFERENCES gp_cloud.tasks(id), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), version INTEGER NOT NULL);
CREATE TABLE gp_cloud.uploads (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES gp_cloud.tasks(id), owner_id TEXT NOT NULL REFERENCES gp_cloud.users(id),
 report_id TEXT REFERENCES gp_cloud.reports(id), storage_name TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880), created_at TEXT NOT NULL
);
CREATE TABLE gp_cloud.issues (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES gp_cloud.tasks(id), author_id TEXT NOT NULL REFERENCES gp_cloud.users(id),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at TEXT NOT NULL
);
CREATE TABLE gp_cloud.planting_receipts (
 task_id TEXT NOT NULL REFERENCES gp_cloud.tasks(id), planting_item_id TEXT NOT NULL, position_index INTEGER NOT NULL,
 plant_id TEXT NOT NULL UNIQUE, report_id TEXT NOT NULL REFERENCES gp_cloud.reports(id), PRIMARY KEY(task_id,planting_item_id,position_index)
);
CREATE TABLE gp_cloud.care_events (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES gp_cloud.tasks(id), report_id TEXT NOT NULL UNIQUE REFERENCES gp_cloud.reports(id),
 object_id TEXT NOT NULL, action TEXT NOT NULL, reviewed_at TEXT NOT NULL, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object')
);
CREATE TABLE gp_cloud.workflow_history (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES gp_cloud.users(id),
 action TEXT NOT NULL, before_json jsonb, after_json jsonb NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX workflow_history_entity ON gp_cloud.workflow_history(entity_type,entity_id);

ALTER TABLE gp_cloud.designs ADD site_kind text GENERATED ALWAYS AS ('site'::text) STORED,
 ADD FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.documents(kind,id),
 ADD CHECK(data->>'id'=id AND (data->>'version')::integer=version AND data->>'status'=status);
ALTER TABLE gp_cloud.tasks ADD object_kind text GENERATED ALWAYS AS (CASE WHEN data->>'objectType'='plant' THEN 'plant' ELSE 'site' END) STORED,
 ADD object_id text GENERATED ALWAYS AS (data->>'objectId') STORED,
 ADD FOREIGN KEY(object_kind,object_id) REFERENCES gp_cloud.documents(kind,id),
 ADD FOREIGN KEY(design_id,design_revision) REFERENCES gp_cloud.design_revisions(design_id,revision),
 ADD CHECK(data->>'id'=id AND (data->>'version')::integer=version AND data->>'status'=status);
ALTER TABLE gp_cloud.planting_receipts ADD plant_kind text GENERATED ALWAYS AS ('plant'::text) STORED,
 ADD FOREIGN KEY(plant_kind,plant_id) REFERENCES gp_cloud.documents(kind,id);
ALTER TABLE gp_cloud.reports ADD CHECK(data->>'id'=id AND (data->>'version')::integer=version AND data->>'reviewStatus'=status);
ALTER TABLE gp_cloud.memberships ADD CHECK(valid_until IS NULL OR valid_until>=valid_from);
CREATE INDEX tasks_crew ON gp_cloud.tasks(crew_id);
CREATE INDEX reports_task ON gp_cloud.reports(task_id);
CREATE INDEX uploads_task ON gp_cloud.uploads(task_id);
CREATE FUNCTION gp_cloud.immutable_approved_revision() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved revision is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 END;
$$;
CREATE TRIGGER immutable_approved_revision BEFORE UPDATE OR DELETE ON gp_cloud.design_revisions
 FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_approved_revision();
REVOKE ALL ON ALL TABLES IN SCHEMA gp_cloud FROM PUBLIC;
REVOKE ALL ON FUNCTION gp_cloud.immutable_approved_revision() FROM PUBLIC;
`;
