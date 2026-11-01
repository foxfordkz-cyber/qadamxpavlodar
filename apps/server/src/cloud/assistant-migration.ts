// Append-only v6: per-user assistant history, separate from public site documents.
export const migration6 = `
CREATE TABLE gp_cloud.assistant_history (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES gp_cloud.users(id),
 at text NOT NULL, question text NOT NULL CHECK(length(question)<=300),
 intent text NOT NULL, method text NOT NULL CHECK(method IN ('rules','model')),
 zones jsonb NOT NULL CHECK(jsonb_typeof(zones)='array')
);
CREATE INDEX assistant_history_user_at ON gp_cloud.assistant_history(user_id,at DESC,id);
REVOKE ALL ON gp_cloud.assistant_history FROM PUBLIC;
`;
