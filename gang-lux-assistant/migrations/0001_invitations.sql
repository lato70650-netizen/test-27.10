-- Authentication data only. The Notion knowledge base remains the only source of answers.
CREATE TABLE IF NOT EXISTS invitations (
  token_hash TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'telegram')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS invitations_expiry ON invitations(expires_at);
CREATE TABLE IF NOT EXISTS web_sessions (
  session_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_members (
  telegram_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
