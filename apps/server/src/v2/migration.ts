// Additive V2 domain. Legacy rows and their original semantics are preserved.
export const migration3 = `
CREATE TABLE v2_users (
 id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','coordinator','foreman','worker')),
 active INTEGER NOT NULL CHECK(active IN (0,1)), password_hash TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE v2_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES v2_users(id), csrf_token TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX v2_sessions_user ON v2_sessions(user_id);
CREATE TABLE v2_login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL) STRICT;
CREATE TABLE v2_profiles (user_id TEXT PRIMARY KEY REFERENCES v2_users(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL) STRICT;
CREATE TABLE v2_crews (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, foreman_id TEXT NOT NULL REFERENCES v2_users(id),
 active INTEGER NOT NULL CHECK(active IN (0,1)), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL CHECK(version>0)
) STRICT;
CREATE TABLE v2_memberships (
 id TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES v2_crews(id), user_id TEXT NOT NULL REFERENCES v2_users(id),
 valid_from TEXT NOT NULL, valid_until TEXT, active INTEGER NOT NULL CHECK(active IN (0,1))
) STRICT;
CREATE UNIQUE INDEX v2_one_active_crew ON v2_memberships(user_id) WHERE active=1;
CREATE TABLE v2_documents (
 kind TEXT NOT NULL CHECK(kind IN ('plant','site','catalog','context','resource','care_policy','evidence','visualization','plan')),
 id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL CHECK(version>0),
 PRIMARY KEY(kind,id)
) STRICT;
CREATE TABLE v2_designs (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('draft','submitted','changes_requested','approved')),
 version INTEGER NOT NULL CHECK(version>0), data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE TABLE v2_design_revisions (
 design_id TEXT NOT NULL REFERENCES v2_designs(id), revision INTEGER NOT NULL, status TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(design_id,revision)
) STRICT;
CREATE TABLE v2_tasks (
 id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','assigned','in_progress','submitted','verified')),
 crew_id TEXT REFERENCES v2_crews(id), design_id TEXT REFERENCES v2_designs(id), design_revision INTEGER,
 version INTEGER NOT NULL CHECK(version>0), data TEXT NOT NULL CHECK(json_valid(data)),
 UNIQUE(design_id,design_revision)
) STRICT;
CREATE TABLE v2_assignments (
 task_id TEXT NOT NULL REFERENCES v2_tasks(id), user_id TEXT NOT NULL REFERENCES v2_users(id), PRIMARY KEY(task_id,user_id)
) STRICT;
CREATE TABLE v2_reports (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES v2_tasks(id), revision INTEGER NOT NULL,
 author_id TEXT NOT NULL REFERENCES v2_users(id), status TEXT NOT NULL CHECK(status IN ('pending','accepted','changes_requested')),
 version INTEGER NOT NULL CHECK(version>0), data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(task_id,revision)
) STRICT;
CREATE TABLE v2_report_drafts (task_id TEXT PRIMARY KEY REFERENCES v2_tasks(id), data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL) STRICT;
CREATE TABLE v2_uploads (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES v2_tasks(id), owner_id TEXT NOT NULL REFERENCES v2_users(id),
 report_id TEXT REFERENCES v2_reports(id), storage_name TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE v2_issues (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES v2_tasks(id), author_id TEXT NOT NULL REFERENCES v2_users(id),
 data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE v2_planting_receipts (
 task_id TEXT NOT NULL REFERENCES v2_tasks(id), planting_item_id TEXT NOT NULL, position_index INTEGER NOT NULL,
 plant_id TEXT NOT NULL UNIQUE, report_id TEXT NOT NULL REFERENCES v2_reports(id), PRIMARY KEY(task_id,planting_item_id,position_index)
) STRICT;
CREATE TABLE v2_care_events (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES v2_tasks(id), report_id TEXT NOT NULL UNIQUE REFERENCES v2_reports(id),
 object_id TEXT NOT NULL, action TEXT NOT NULL, reviewed_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE TABLE v2_history (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES v2_users(id),
 action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL CHECK(json_valid(after_json)), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX v2_history_entity ON v2_history(entity_type,entity_id);
CREATE TABLE v2_idempotency (
 actor_id TEXT NOT NULL REFERENCES v2_users(id), method TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL,
 request_hash TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 created_at TEXT NOT NULL, PRIMARY KEY(actor_id,method,path,key)
) STRICT;
`;
