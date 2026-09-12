CREATE TABLE IF NOT EXISTS ai_daily_budget (
  day date PRIMARY KEY,
  reserved_units integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0
);
