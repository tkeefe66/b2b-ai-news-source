CREATE TABLE IF NOT EXISTS auth_sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expire_idx ON auth_sessions (expire);
