import { pool } from "./db";

let inFlight = 0;
function limit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name} configuration`);
  return value;
}

// Units conservatively reserve input bytes plus maximum output tokens. This is
// an admission ceiling, not a dollar estimate or reported provider token usage.
export async function acquireAiPermit(input: unknown, outputTokens: number): Promise<() => void> {
  if (process.env.AI_ENABLED === "false") throw new Error("AI is temporarily disabled by the operator.");
  const bytes = Buffer.byteLength(JSON.stringify(input));
  if (bytes > 1_000_000 || !Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 32768) {
    throw new Error("AI request is too large. Use a smaller document or conversation.");
  }
  if (inFlight >= limit("AI_MAX_CONCURRENT", 6)) throw new Error("AI is busy. Please retry shortly.");
  inFlight++;
  let released = false;
  const release = () => { if (!released) { released = true; inFlight--; } };
  try {
    const units = bytes + outputTokens;
    const maximum = limit("AI_DAILY_MAX_UNITS", 20_000_000);
    const calls = limit("AI_DAILY_MAX_CALLS", 2000);
    if (units > maximum) throw new Error("AI daily allowance is too small for this request.");
    const result = await pool.query(`
      INSERT INTO ai_daily_budget (day, reserved_units, calls)
      VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $1, 1)
      ON CONFLICT (day) DO UPDATE SET
        reserved_units = ai_daily_budget.reserved_units + EXCLUDED.reserved_units,
        calls = ai_daily_budget.calls + 1
      WHERE ai_daily_budget.reserved_units + EXCLUDED.reserved_units <= $2
        AND ai_daily_budget.calls < $3
      RETURNING day`, [units, maximum, calls]);
    if (!result.rows.length) throw new Error("Daily AI allowance reached. Retry tomorrow or ask the operator to adjust it.");
    return release;
  } catch (error) { release(); throw error; }
}
