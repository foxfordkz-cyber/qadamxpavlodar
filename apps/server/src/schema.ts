// DRAFT v1. This is a local preparation schema, not the team's agreed contract.
export const schema = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('coordinator','worker')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
) STRICT;
CREATE TABLE plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  condition TEXT NOT NULL CHECK(condition IN ('good','needs_care','unknown')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
) STRICT;
CREATE TABLE candidate_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  notes TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
) STRICT;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  plant_id TEXT REFERENCES plants(id),
  candidate_site_id TEXT REFERENCES candidate_sites(id),
  assigned_to_id TEXT NOT NULL REFERENCES users(id),
  created_by_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
  CHECK((plant_id IS NOT NULL) + (candidate_site_id IS NOT NULL) = 1)
) STRICT;
CREATE INDEX tasks_assignee ON tasks(assigned_to_id, status);
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  notes TEXT NOT NULL CHECK(length(notes) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
) STRICT;
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  plant_id TEXT REFERENCES plants(id),
  candidate_site_id TEXT REFERENCES candidate_sites(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  report_id TEXT REFERENCES reports(id),
  notes TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
  CHECK((plant_id IS NOT NULL) + (candidate_site_id IS NOT NULL) = 1)
) STRICT;
-- Metadata only. Normalized binary photos live in private local uploads/.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  storage_name TEXT NOT NULL UNIQUE CHECK(storage_name NOT LIKE '%/%' AND storage_name NOT LIKE '%\\%' AND storage_name NOT IN ('.','..')),
  media_type TEXT NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
) STRICT;
CREATE TABLE evidence_refs (
  id TEXT PRIMARY KEY,
  plant_id TEXT REFERENCES plants(id),
  candidate_site_id TEXT REFERENCES candidate_sites(id),
  source_label TEXT NOT NULL,
  source_uri TEXT,
  retrieved_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
  CHECK((plant_id IS NOT NULL) + (candidate_site_id IS NOT NULL) = 1)
) STRICT;
CREATE TABLE task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  from_status TEXT CHECK(from_status IN ('pending','in_progress','completed','cancelled')),
  to_status TEXT NOT NULL CHECK(to_status IN ('pending','in_progress','completed','cancelled')),
  version INTEGER NOT NULL CHECK(version > 0),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  changed_at TEXT NOT NULL,
  UNIQUE(task_id, version)
) STRICT;
CREATE TABLE idempotency_keys (
  actor_id TEXT NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, method, path, key)
) STRICT;
`;
