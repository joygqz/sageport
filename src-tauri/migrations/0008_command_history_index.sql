CREATE INDEX idx_history_host_used ON command_history (host_id, used_at DESC);
