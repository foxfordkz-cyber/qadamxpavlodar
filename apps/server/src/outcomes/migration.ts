export const outcomesMigration = `
CREATE TABLE outcome_snapshots (
 id TEXT PRIMARY KEY, site_kind TEXT NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES v2_users(id),
 FOREIGN KEY(site_kind,site_id) REFERENCES v2_documents(kind,id)
) STRICT;
CREATE TABLE outcome_cohorts (
 id TEXT PRIMARY KEY, site_kind TEXT NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id TEXT NOT NULL,
 snapshot_id TEXT REFERENCES outcome_snapshots(id), data TEXT NOT NULL CHECK(json_valid(data)),
 version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES v2_users(id),
 FOREIGN KEY(site_kind,site_id) REFERENCES v2_documents(kind,id)
) STRICT;
CREATE TABLE outcome_members (
 cohort_id TEXT NOT NULL REFERENCES outcome_cohorts(id), plant_kind TEXT NOT NULL DEFAULT 'plant' CHECK(plant_kind='plant'),
 plant_id TEXT NOT NULL UNIQUE, PRIMARY KEY(cohort_id,plant_id),
 FOREIGN KEY(plant_kind,plant_id) REFERENCES v2_documents(kind,id)
) STRICT;
CREATE TABLE outcome_inspections (
 id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL REFERENCES outcome_cohorts(id), observed_on TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL, reviewer_id TEXT NOT NULL REFERENCES v2_users(id),
 UNIQUE(cohort_id,observed_on)
) STRICT;
CREATE TABLE outcome_sources (
 inspection_id TEXT NOT NULL REFERENCES outcome_inspections(id), plant_kind TEXT NOT NULL DEFAULT 'plant' CHECK(plant_kind='plant'),
 plant_id TEXT NOT NULL, report_id TEXT REFERENCES v2_reports(id),
 FOREIGN KEY(plant_kind,plant_id) REFERENCES v2_documents(kind,id)
) STRICT;
CREATE TRIGGER outcome_snapshot_immutable BEFORE UPDATE ON outcome_snapshots BEGIN SELECT RAISE(ABORT,'Immutable snapshot'); END;
CREATE TRIGGER outcome_snapshot_no_delete BEFORE DELETE ON outcome_snapshots BEGIN SELECT RAISE(ABORT,'Immutable snapshot'); END;
CREATE TRIGGER outcome_inspection_immutable BEFORE UPDATE ON outcome_inspections BEGIN SELECT RAISE(ABORT,'Append-only inspection'); END;
CREATE TRIGGER outcome_inspection_no_delete BEFORE DELETE ON outcome_inspections BEGIN SELECT RAISE(ABORT,'Append-only inspection'); END;
CREATE TRIGGER outcome_cohort_immutable BEFORE UPDATE ON outcome_cohorts
 WHEN NEW.site_id!=OLD.site_id OR NEW.snapshot_id IS NOT OLD.snapshot_id
 OR json_remove(NEW.data,'$.version')!=json_remove(OLD.data,'$.version')
 BEGIN SELECT RAISE(ABORT,'Immutable cohort content'); END;
`;
