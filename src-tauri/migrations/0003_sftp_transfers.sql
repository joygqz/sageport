-- Persisted history of SFTP/local file transfers, so the transfer panel can
-- show what ran in past sessions (not just the in-flight progress strip).
-- Local device state, not part of the sync vault.

CREATE TABLE sftp_transfers (
  id                  TEXT PRIMARY KEY NOT NULL,
  source_label        TEXT NOT NULL,
  source_path         TEXT NOT NULL,
  source_connection_id TEXT,
  dest_path           TEXT NOT NULL,
  dest_connection_id  TEXT,
  total_bytes         INTEGER NOT NULL DEFAULT 0,
  transferred_bytes   INTEGER NOT NULL DEFAULT 0,
  -- "active" | "done" | "error" | "cancelled"
  status              TEXT NOT NULL DEFAULT 'active',
  message             TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);

CREATE INDEX idx_sftp_transfers_started ON sftp_transfers (started_at DESC);
