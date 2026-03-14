ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id TEXT;

UPDATE users
SET avatar_id = 'spark'
WHERE avatar_id IS NULL;

ALTER TABLE users
ALTER COLUMN avatar_id SET DEFAULT 'spark';
