import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  query_timeout: 35000,
  max: 10,
});

pool.on("error", () => console.error("Database pool connection failed; requests will retry on a new connection."));

export const db = drizzle(pool, { schema });
