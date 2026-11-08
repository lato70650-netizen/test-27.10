-- Only Telegram access metadata, no Notion answers or messages.
CREATE TABLE IF NOT EXISTS shared_telegram_members (
 telegram_id TEXT PRIMARY KEY,
 access_version TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
