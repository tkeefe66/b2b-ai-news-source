CREATE TABLE IF NOT EXISTS brief_recipient_settings (
  id text PRIMARY KEY,
  recipients json NOT NULL
);
