import { pool } from "../db";
import { blog } from "./log";

export async function ensureBriefsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS briefs (
      id SERIAL PRIMARY KEY,
      brief_date TEXT NOT NULL,
      manual BOOLEAN NOT NULL DEFAULT FALSE,
      period_start TIMESTAMP,
      period_end TIMESTAMP,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      sent_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS briefs_real_daily_uniq
    ON briefs (brief_date) WHERE manual = FALSE
  `);
  blog("briefs table ready");
}
