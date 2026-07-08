CREATE TABLE command_history (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_history_host_cmd ON command_history (host_id, command);
