CREATE TABLE sftp_bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_sftp_bookmarks_host ON sftp_bookmarks (host_id);
