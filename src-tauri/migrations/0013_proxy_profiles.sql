CREATE TABLE proxy_profiles (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL,
  username   TEXT,
  password   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_proxy_profiles_updated ON proxy_profiles (updated_at);
