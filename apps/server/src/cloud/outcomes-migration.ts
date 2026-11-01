/** Stage D: canonical registry references and append-only Outcomes. Published migrations stay intact. */
export const migration5 = `
CREATE TABLE gp_cloud.outcome_snapshots (
 id text PRIMARY KEY, site_kind text NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at text NOT NULL, created_by text NOT NULL REFERENCES gp_cloud.users(id),
 FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.documents(kind,id)
);
CREATE TABLE gp_cloud.outcome_cohorts (
 id text PRIMARY KEY, site_kind text NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id text NOT NULL,
 snapshot_id text REFERENCES gp_cloud.outcome_snapshots(id), data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 version integer NOT NULL CHECK(version>0), created_at text NOT NULL, created_by text NOT NULL REFERENCES gp_cloud.users(id),
 FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.documents(kind,id),
 CHECK(data->>'id'=id AND data->>'siteId'=site_id AND (data->>'version')::integer=version)
);
CREATE TABLE gp_cloud.outcome_members (
 cohort_id text NOT NULL REFERENCES gp_cloud.outcome_cohorts(id), plant_kind text NOT NULL DEFAULT 'plant' CHECK(plant_kind='plant'),
 plant_id text NOT NULL UNIQUE, PRIMARY KEY(cohort_id,plant_id),
 FOREIGN KEY(plant_kind,plant_id) REFERENCES gp_cloud.documents(kind,id)
);
CREATE TABLE gp_cloud.outcome_inspections (
 id text PRIMARY KEY, cohort_id text NOT NULL REFERENCES gp_cloud.outcome_cohorts(id), observed_on text NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at text NOT NULL, reviewer_id text NOT NULL REFERENCES gp_cloud.users(id),
 UNIQUE(cohort_id,observed_on), CHECK(data->>'id'=id AND data->>'cohortId'=cohort_id AND data->>'observedOn'=observed_on)
);
CREATE TABLE gp_cloud.outcome_sources (
 inspection_id text NOT NULL REFERENCES gp_cloud.outcome_inspections(id), plant_kind text NOT NULL DEFAULT 'plant' CHECK(plant_kind='plant'),
 plant_id text NOT NULL, report_id text REFERENCES gp_cloud.reports(id), PRIMARY KEY(inspection_id,plant_id),
 FOREIGN KEY(plant_kind,plant_id) REFERENCES gp_cloud.documents(kind,id)
);
CREATE INDEX outcome_cohorts_site ON gp_cloud.outcome_cohorts(site_id);
CREATE FUNCTION gp_cloud.immutable_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Append-only Outcomes record' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER outcome_snapshot_immutable BEFORE UPDATE OR DELETE ON gp_cloud.outcome_snapshots FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_outcome();
CREATE TRIGGER outcome_inspection_immutable BEFORE UPDATE OR DELETE ON gp_cloud.outcome_inspections FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_outcome();
CREATE TRIGGER outcome_sources_immutable BEFORE UPDATE OR DELETE ON gp_cloud.outcome_sources FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_outcome();
CREATE TRIGGER outcome_members_immutable BEFORE UPDATE OR DELETE ON gp_cloud.outcome_members FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_outcome();
CREATE FUNCTION gp_cloud.immutable_cohort() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.site_kind IS DISTINCT FROM OLD.site_kind OR NEW.site_id IS DISTINCT FROM OLD.site_id
 OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id OR (NEW.data-'version') IS DISTINCT FROM (OLD.data-'version')
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
 RAISE EXCEPTION 'Immutable cohort content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 END;
$$;
CREATE TRIGGER outcome_cohort_immutable BEFORE UPDATE ON gp_cloud.outcome_cohorts FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_cohort();
REVOKE ALL ON ALL TABLES IN SCHEMA gp_cloud FROM PUBLIC;
REVOKE ALL ON FUNCTION gp_cloud.immutable_outcome(),gp_cloud.immutable_cohort() FROM PUBLIC;
`;
