import pg from "pg";
import { runArticleRetention } from "../server/article-retention";

// Railway injects the public proxy URL for use outside its private network.
process.env.TZ = "UTC";
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !["--dry-run", "--apply"].includes(arg))) {
  throw new Error("Usage: tsx script/article-retention.ts [--dry-run | --apply]");
}
const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_PUBLIC_URL or DATABASE_URL is required");
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 30000, max: 2 });
try {
  const result = await runArticleRetention(pool, { dryRun: !args.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
