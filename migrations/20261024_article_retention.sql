-- Additive only. Apply before deploying the retention-aware ingestion code.
CREATE TABLE IF NOT EXISTS article_seen_keys (
  key_hash varchar(64) PRIMARY KEY,
  last_seen_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS article_seen_keys_expiry_idx ON article_seen_keys(last_seen_at);
CREATE INDEX IF NOT EXISTS articles_retention_idx
  ON articles (LEAST(COALESCE(published_at, created_at), created_at));
