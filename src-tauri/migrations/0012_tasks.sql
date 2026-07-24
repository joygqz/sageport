CREATE TABLE tasks (
  id               TEXT PRIMARY KEY NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  host_id          TEXT,
  steps            TEXT NOT NULL,
  schedule         TEXT,
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  revision         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_name ON tasks (name COLLATE NOCASE);

CREATE TABLE task_runs (
  id          TEXT PRIMARY KEY NOT NULL,
  task_id     TEXT NOT NULL,
  task_name   TEXT NOT NULL,
  host_id     TEXT,
  host_label  TEXT,
  steps       TEXT NOT NULL,
  total_steps INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'running',
  message     TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_task_runs_started ON task_runs (started_at DESC);
