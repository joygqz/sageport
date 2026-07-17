ALTER TABLE hosts ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0;

-- Preserve the safety intent of the former Production environment marker,
-- then retire environment colors as a host organization mechanism.
UPDATE hosts SET requires_approval = 1 WHERE color = '#ef4444';
UPDATE hosts SET color = NULL;
