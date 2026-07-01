-- Persisted AI assistant chat sessions. `messages` holds the full canonical
-- conversation (JSON array of `ai::ChatMessage`, never including a `system`
-- entry) so a session can be reloaded exactly as the agent left it. Sessions
-- are local device state, not part of the sync vault.

CREATE TABLE ai_sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  messages   TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_sessions_updated ON ai_sessions (updated_at);
