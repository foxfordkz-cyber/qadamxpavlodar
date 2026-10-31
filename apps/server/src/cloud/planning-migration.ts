// Append-only migration 2. Published migration 1 and its checksum are untouched.
export const migration2 = `
CREATE TABLE gp_cloud.planning_documents (
 kind text NOT NULL CHECK(kind IN ('site','context','catalog','species','settings','layer')),
 id text NOT NULL, data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 version integer NOT NULL CHECK(version>0), position integer NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,id),
 CHECK(kind IN ('settings','layer') OR (data ? 'id' AND data->>'id'=id)),
 CHECK(NOT(data ? 'version') OR (data->>'version')::integer=version)
);
CREATE INDEX planning_order ON gp_cloud.planning_documents(kind,position,id);
CREATE TABLE gp_cloud.zone_contexts (
 site_kind text NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id text NOT NULL,
 radius integer NOT NULL CHECK(radius IN (30,50,100,200)), site_version integer NOT NULL CHECK(site_version>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), PRIMARY KEY(site_id,radius),
 FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.planning_documents(kind,id)
);
CREATE TABLE gp_cloud.analysis_snapshots (
 id text PRIMARY KEY, site_kind text NOT NULL DEFAULT 'site' CHECK(site_kind='site'), site_id text NOT NULL,
 actor_id text NOT NULL REFERENCES gp_cloud.users(id), input_hash text NOT NULL CHECK(length(input_hash)=64),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND data ? 'inputSnapshot'), created_at text NOT NULL,
 FOREIGN KEY(site_kind,site_id) REFERENCES gp_cloud.planning_documents(kind,id)
);
CREATE INDEX analysis_site ON gp_cloud.analysis_snapshots(site_id,created_at);
CREATE TABLE gp_cloud.planning_history (
 id text PRIMARY KEY, entity_kind text NOT NULL, entity_id text NOT NULL,
 actor_id text NOT NULL REFERENCES gp_cloud.users(id), action text NOT NULL,
 before_json jsonb, after_json jsonb NOT NULL, created_at text NOT NULL,
 FOREIGN KEY(entity_kind,entity_id) REFERENCES gp_cloud.planning_documents(kind,id)
);
CREATE INDEX planning_history_entity ON gp_cloud.planning_history(entity_kind,entity_id,created_at);
CREATE FUNCTION gp_cloud.immutable_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Analysis snapshots are immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER immutable_analysis BEFORE UPDATE OR DELETE ON gp_cloud.analysis_snapshots
 FOR EACH ROW EXECUTE FUNCTION gp_cloud.immutable_analysis();
REVOKE ALL ON ALL TABLES IN SCHEMA gp_cloud FROM PUBLIC;
REVOKE ALL ON FUNCTION gp_cloud.immutable_analysis() FROM PUBLIC;
`;
