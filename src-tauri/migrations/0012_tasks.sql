-- User-defined automation tasks: an ordered mix of local/remote commands and
-- file transfers. Belongs to the sync vault (synced across devices), so it
-- follows the same soft-delete + revision shape as snippets.
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  host_id     TEXT,            -- default target host; NULL = choose at run time
  steps       TEXT NOT NULL,   -- JSON array of TaskStep
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,            -- soft delete, matching snippets
  revision    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_name ON tasks (name COLLATE NOCASE);
