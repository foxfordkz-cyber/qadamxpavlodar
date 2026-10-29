export const migration4=`
CREATE TABLE municipal_roles(user_id TEXT PRIMARY KEY REFERENCES v2_users(id),role TEXT NOT NULL CHECK(role IN ('specialist','viewer'))) STRICT;
CREATE TABLE municipal_state(key TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL) STRICT;
CREATE TABLE municipal_imports(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES v2_users(id),data TEXT NOT NULL CHECK(json_valid(data)),created_at TEXT NOT NULL,expires_at TEXT NOT NULL,committed_at TEXT) STRICT;
CREATE TABLE municipal_features(id TEXT PRIMARY KEY,layer TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),import_id TEXT NOT NULL REFERENCES municipal_imports(id),UNIQUE(layer,fingerprint)) STRICT;
CREATE TABLE municipal_history(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES v2_users(id),data TEXT NOT NULL CHECK(json_valid(data)),created_at TEXT NOT NULL) STRICT;
CREATE TABLE municipal_analyses(id TEXT PRIMARY KEY,site_id TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES v2_users(id),input_hash TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),created_at TEXT NOT NULL) STRICT;
`;
