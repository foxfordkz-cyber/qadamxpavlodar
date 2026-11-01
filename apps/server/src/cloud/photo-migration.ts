// Append-only migration 4. An intent survives a remote success followed by a failed DB commit.
export const migration4 = `
CREATE TABLE gp_cloud.upload_intents (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES gp_cloud.users(id),
 task_id text NOT NULL REFERENCES gp_cloud.tasks(id), key text NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 storage_name text NOT NULL UNIQUE CHECK(storage_name='demo/'||id||'.webp'),
 sha256 text NOT NULL CHECK(length(sha256)=64), byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 state text NOT NULL CHECK(state IN ('pending','committed','cleaned')),
 created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(owner_id,key)
);
CREATE INDEX upload_intents_pending ON gp_cloud.upload_intents(updated_at) WHERE state='pending';
ALTER TABLE gp_cloud.uploads ADD FOREIGN KEY(id) REFERENCES gp_cloud.upload_intents(id);
REVOKE ALL ON gp_cloud.upload_intents FROM PUBLIC;
`;
