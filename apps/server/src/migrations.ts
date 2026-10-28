// Additive local experiment. The legacy task/report schema and statuses stay intact.
export const migration2 = `
CREATE TABLE experimental_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  plant_id TEXT REFERENCES plants(id), candidate_site_id TEXT REFERENCES candidate_sites(id),
  assigned_to_id TEXT REFERENCES users(id), created_by_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('draft','assigned','in_progress','submitted','verified')),
  version INTEGER NOT NULL CHECK(version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo=1),
  CHECK((plant_id IS NOT NULL) + (candidate_site_id IS NOT NULL) = 1),
  CHECK((status='draft' AND assigned_to_id IS NULL) OR (status!='draft' AND assigned_to_id IS NOT NULL))
) STRICT;
CREATE INDEX experimental_task_owner ON experimental_tasks(assigned_to_id,status);
CREATE TABLE experimental_reports (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES experimental_tasks(id),
  author_id TEXT NOT NULL REFERENCES users(id), notes TEXT NOT NULL CHECK(length(notes) BETWEEN 1 AND 4000),
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('submitted','verified','returned')),
  review_comment TEXT, reviewed_by_id TEXT REFERENCES users(id), reviewed_at TEXT,
  created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo=1),
  UNIQUE(task_id,revision), CHECK(status!='returned' OR length(trim(review_comment))>0)
) STRICT;
CREATE TABLE experimental_task_history (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES experimental_tasks(id),
  actor_id TEXT NOT NULL REFERENCES users(id), from_status TEXT, to_status TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','assign','start','submit','verify','return','attach_photo')),
  comment TEXT, version INTEGER NOT NULL CHECK(version>0),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), changed_at TEXT NOT NULL,
  UNIQUE(task_id,version), CHECK(action!='return' OR length(trim(comment))>0)
) STRICT;
CREATE TABLE experimental_photos (
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES experimental_reports(id),
  storage_name TEXT NOT NULL UNIQUE CHECK(storage_name NOT LIKE '%/%' AND storage_name NOT LIKE '%\\%'),
  media_type TEXT NOT NULL CHECK(media_type='image/webp'),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo=1)
) STRICT;
CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY, snapshot_version TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL CHECK(status IN ('draft','confirmed')), version INTEGER NOT NULL CHECK(version>0),
  created_by_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  confirmed_task_id TEXT REFERENCES experimental_tasks(id), confirmed_at TEXT,
  CHECK((status='draft' AND confirmed_task_id IS NULL) OR (status='confirmed' AND confirmed_task_id IS NOT NULL))
) STRICT;
`;
