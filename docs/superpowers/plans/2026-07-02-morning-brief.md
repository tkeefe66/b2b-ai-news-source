# Morning Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekday-morning email brief composed from the app's existing articles/trends/competitor data, sent via Resend, with an in-app archive page — the push experience from `docs/superpowers/specs/2026-07-02-morning-brief-design.md`.

**Architecture:** New `server/morning-brief/` module in the existing Express app. A pure-logic scheduling core (timezone, due-check, status machine) drives a pipeline: gather inputs → one Claude call → zod-validated `BriefPayload` → HTML email renderer → Resend delivery, with a `briefs` table as the restart-safe ledger. In-process 5-minute tick alongside the existing RSS `setInterval` loops. One new client page renders the same payload web-style.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM (PostgreSQL), zod, Anthropic via existing `server/ai-models.ts` `chatCompletion`, Resend SDK (new dep), p-retry (existing), date-fns (existing), vitest (new devDep), React 18 + wouter + TanStack Query + shadcn/ui.

## Global Constraints

- Model: `claude-sonnet-4-6` (already in `AVAILABLE_MODELS`), called via `chatCompletion` from `server/ai-models.ts`. Never instantiate a new Anthropic client.
- Email sender: `GTM Brief <onboarding@resend.dev>` (pilot; domain verification deferred).
- Subject format, verbatim: `GTM Brief · {EEE MMM d} — {headline}` e.g. `GTM Brief · Thu Jul 2 — 6sense reprices`.
- Brand: masthead `#0D1846` (Midnight); orange `#F26B43` ONLY for the Demandbase-angle callout label and the footer "Open dashboard →" button. Angle callouts use tinted background `#FFF3EE`, NOT a left-border stripe.
- Defaults: `BRIEF_HOUR=7`, `BRIEF_TZ=America/Chicago`. Weekdays only. Quiet days still send.
- Max 3 compose attempts per day, then fallback headlines email. One repair pass per compose attempt. Manual (send-now) runs never fall back and never satisfy the daily due-check.
- Convention deviation from spec (deliberate): `payload` is a `text` column holding JSON (matches `trend_snapshots.trends` convention — this codebase does not use `jsonb`), and `brief_date` is `text` `YYYY-MM-DD` computed in `BRIEF_TZ`.
- New dependencies limited to: `resend` (dependency), `vitest` (devDependency). Everything else exists.
- All server logging via a local `blog()` helper (same format as `log()` in `server/index.ts`, source `morning-brief`) — do NOT import `log` from `server/index.ts` (circular import).
- `tsconfig.json` excludes `**/*.test.ts` from `npm run check`; vitest transpiles tests itself. Do not "fix" this.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

```
shared/
  brief-payload.ts            BriefPayload zod schema + types (shared client/server)
  brief-payload.test.ts
  schema.ts                   + briefs table, insertBriefSchema, Brief/InsertBrief types
server/
  storage.ts                  + 6 brief methods on IStorage + DatabaseStorage
  index.ts                    + ensureBriefsTable() + startBriefScheduler() wiring
  routes.ts                   + POST /api/brief/send-now, GET /api/briefs, GET /api/briefs/:id
  morning-brief/
    log.ts                    blog() logging helper
    config.ts                 getBriefConfig() env parsing
    config.test.ts
    ensure-table.ts           idempotent CREATE TABLE/INDEX at startup
    schedule-logic.ts         zonedParts, shouldRunNow, computeWindow, nextAction (pure)
    schedule-logic.test.ts
    composer.ts               gatherInputs, matchCompetitors, buildBriefPrompt, composeBrief
    composer.test.ts
    render-email.ts           renderBriefEmail, renderFallbackEmail, esc
    render-email.test.ts
    deliver.ts                sendEmail via Resend + p-retry
    deliver.test.ts
    scheduler.ts              briefTick, runManualBrief, startBriefScheduler, executeAction
    scheduler.test.ts
client/src/
  App.tsx                     + lazy route /morning-brief
  components/app-sidebar.tsx  + nav item
  pages/morning-brief.tsx     archive list + payload view + send-test button
vitest.config.ts
.env.example                  + 5 new vars
```

---

### Task 1: Vitest infrastructure + BriefPayload schema

**Files:**
- Create: `vitest.config.ts`
- Create: `shared/brief-payload.ts`
- Test: `shared/brief-payload.test.ts`
- Modify: `package.json` (add `test` script, install vitest)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `briefPayloadSchema` (zod), `type BriefPayload = z.infer<typeof briefPayloadSchema>`, `type TopStory = BriefPayload["topStories"][number]` from `@shared/brief-payload`. `npm test` runs vitest.

- [ ] **Step 1: Install vitest and add the test script**

```bash
npm install -D vitest
```

Then in `package.json` `"scripts"`, after `"check": "tsc",` add:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `shared/brief-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { briefPayloadSchema } from "./brief-payload";

const validPayload = {
  date: "2026-07-02",
  headline: "6sense reprices, CDP consolidation accelerates",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [
    {
      title: "6sense announces new pricing model",
      whyItMatters: "Directly reshapes ABM platform deal economics.",
      dbAngle: { strength: "strong", text: "Demandbase can counter on transparent pricing." },
      sourceName: "TechCrunch",
      link: "https://techcrunch.com/example",
      articleId: 123,
    },
  ],
  competitorWatch: [
    {
      competitor: "6sense",
      summary: "Announced usage-based pricing.",
      links: [{ title: "6sense pricing news", url: "https://example.com/a" }],
    },
  ],
  trendPulse: [
    { trend: "CDP consolidation", direction: "rising", note: "Third acquisition this month." },
  ],
  radar: [
    { title: "HubSpot ships AI agents", sourceName: "MarTech Today", link: "https://example.com/b" },
  ],
  contentIdea: {
    title: "LinkedIn post: pricing transparency",
    description: "Hot take on usage-based pricing risk.",
    deepLink: "/thought-leadership",
  },
  quietDay: false,
};

describe("briefPayloadSchema", () => {
  it("accepts a fully-populated valid payload", () => {
    const result = briefPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts a quiet day with one story, empty sections, no contentIdea", () => {
    const quiet = {
      ...validPayload,
      topStories: [validPayload.topStories[0]],
      competitorWatch: [],
      trendPulse: [],
      radar: [],
      contentIdea: undefined,
      quietDay: true,
    };
    const result = briefPayloadSchema.safeParse(quiet);
    expect(result.success).toBe(true);
  });

  it("rejects zero top stories", () => {
    const result = briefPayloadSchema.safeParse({ ...validPayload, topStories: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 top stories", () => {
    const stories = Array.from({ length: 6 }, () => validPayload.topStories[0]);
    const result = briefPayloadSchema.safeParse({ ...validPayload, topStories: stories });
    expect(result.success).toBe(false);
  });

  it("rejects more than 8 radar items", () => {
    const radar = Array.from({ length: 9 }, () => validPayload.radar[0]);
    const result = briefPayloadSchema.safeParse({ ...validPayload, radar });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid dbAngle strength", () => {
    const bad = {
      ...validPayload,
      topStories: [{ ...validPayload.topStories[0], dbAngle: { strength: "weak", text: "x" } }],
    };
    const result = briefPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL top story link", () => {
    const bad = {
      ...validPayload,
      topStories: [{ ...validPayload.topStories[0], link: "not-a-url" }],
    };
    const result = briefPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './brief-payload'` (or equivalent resolve error).

- [ ] **Step 5: Write the schema**

Create `shared/brief-payload.ts`:

```ts
import { z } from "zod";

export const briefPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headline: z.string().min(1).max(160),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  topStories: z
    .array(
      z.object({
        title: z.string().min(1),
        whyItMatters: z.string().min(1),
        dbAngle: z
          .object({
            strength: z.enum(["strong", "moderate"]),
            text: z.string().min(1),
          })
          .optional(),
        sourceName: z.string().min(1),
        link: z.string().url(),
        articleId: z.number(),
      }),
    )
    .min(1)
    .max(5),
  competitorWatch: z.array(
    z.object({
      competitor: z.string().min(1),
      summary: z.string().min(1),
      links: z.array(z.object({ title: z.string(), url: z.string() })),
    }),
  ),
  trendPulse: z.array(
    z.object({
      trend: z.string().min(1),
      direction: z.enum(["rising", "cooling"]),
      note: z.string().min(1),
    }),
  ),
  radar: z
    .array(z.object({ title: z.string().min(1), sourceName: z.string(), link: z.string() }))
    .max(8),
  contentIdea: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      deepLink: z.string().min(1),
    })
    .optional(),
  quietDay: z.boolean(),
});

export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export type TopStory = BriefPayload["topStories"][number];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run check
git add package.json package-lock.json vitest.config.ts shared/brief-payload.ts shared/brief-payload.test.ts
git commit -m "feat: add vitest infra and BriefPayload schema for morning brief

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: briefs table, storage methods, startup DDL

**Files:**
- Modify: `shared/schema.ts` (append after the `crawlEntries` section at the end of the file)
- Modify: `server/storage.ts` (add to `IStorage` interface ~line 45 block and `DatabaseStorage` class)
- Create: `server/morning-brief/log.ts`
- Create: `server/morning-brief/ensure-table.ts`
- Modify: `server/index.ts` (wire `ensureBriefsTable()` in the listen callback)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - Schema exports: `briefs`, `insertBriefSchema`, `type Brief`, `type InsertBrief` from `@shared/schema`.
  - Storage methods (on `storage` singleton): `getBriefs(limit?: number): Promise<Brief[]>`, `getBrief(id: number): Promise<Brief | undefined>`, `getRealBriefByDate(briefDate: string): Promise<Brief | undefined>`, `getLatestRealBrief(): Promise<Brief | undefined>`, `createBrief(data: InsertBrief): Promise<Brief>`, `updateBrief(id: number, data: Partial<InsertBrief>): Promise<Brief | undefined>`.
  - `ensureBriefsTable(): Promise<void>` from `server/morning-brief/ensure-table`.
  - `blog(message: string): void` from `server/morning-brief/log`.
  - Status values used everywhere: `"pending" | "composed" | "sent" | "sent_fallback" | "failed_compose" | "failed_send"`.

- [ ] **Step 1: Add the table to `shared/schema.ts`**

Append at the end of the file:

```ts
export const briefs = pgTable("briefs", {
  id: serial("id").primaryKey(),
  briefDate: text("brief_date").notNull(), // YYYY-MM-DD in BRIEF_TZ
  manual: boolean("manual").default(false).notNull(),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  payload: text("payload"), // JSON string of BriefPayload (null until composed)
  status: text("status").notNull().default("pending"), // pending|composed|sent|sent_fallback|failed_compose|failed_send
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertBriefSchema = createInsertSchema(briefs).omit({
  id: true,
  createdAt: true,
});

export type Brief = typeof briefs.$inferSelect;
export type InsertBrief = z.infer<typeof insertBriefSchema>;
```

Note: `pgTable`, `text`, `serial`, `integer`, `timestamp`, `boolean`, `sql`, `createInsertSchema`, and `z` are already imported at the top of `schema.ts` (match the existing import lines; add any of these that are missing to the existing import statements rather than new ones).

- [ ] **Step 2: Add storage methods**

In `server/storage.ts`, add to the type imports from `@shared/schema`: `briefs, type Brief, type InsertBrief`.

In the `IStorage` interface, add:

```ts
  // Morning Brief
  getBriefs(limit?: number): Promise<Brief[]>;
  getBrief(id: number): Promise<Brief | undefined>;
  getRealBriefByDate(briefDate: string): Promise<Brief | undefined>;
  getLatestRealBrief(): Promise<Brief | undefined>;
  createBrief(data: InsertBrief): Promise<Brief>;
  updateBrief(id: number, data: Partial<InsertBrief>): Promise<Brief | undefined>;
```

In the `DatabaseStorage` class, add (mirror the style of the existing briefings methods around line 497 — `db.select().from(...).orderBy(desc(...))`; `desc`, `eq`, `and` are already imported from drizzle-orm in this file):

```ts
  // Morning Brief
  async getBriefs(limit = 30): Promise<Brief[]> {
    return db.select().from(briefs).orderBy(desc(briefs.createdAt)).limit(limit);
  }

  async getBrief(id: number): Promise<Brief | undefined> {
    const [row] = await db.select().from(briefs).where(eq(briefs.id, id));
    return row;
  }

  async getRealBriefByDate(briefDate: string): Promise<Brief | undefined> {
    const [row] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.briefDate, briefDate), eq(briefs.manual, false)));
    return row;
  }

  async getLatestRealBrief(): Promise<Brief | undefined> {
    const [row] = await db
      .select()
      .from(briefs)
      .where(eq(briefs.manual, false))
      .orderBy(desc(briefs.createdAt))
      .limit(1);
    return row;
  }

  async createBrief(data: InsertBrief): Promise<Brief> {
    const [row] = await db.insert(briefs).values(data).returning();
    return row;
  }

  async updateBrief(id: number, data: Partial<InsertBrief>): Promise<Brief | undefined> {
    const [row] = await db.update(briefs).set(data).where(eq(briefs.id, id)).returning();
    return row;
  }
```

- [ ] **Step 3: Create the logging helper**

Create `server/morning-brief/log.ts`:

```ts
export function blog(message: string) {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [morning-brief] ${message}`);
}
```

- [ ] **Step 4: Create the startup DDL**

Create `server/morning-brief/ensure-table.ts`:

```ts
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
```

(Startup DDL with `IF NOT EXISTS` follows the repo's established pattern — `initializeVectorSupport()` in `server/embeddings.ts` — and avoids interactive `drizzle-kit push`, per `replit.md`.)

- [ ] **Step 5: Wire into `server/index.ts`**

Add to the imports at the top:

```ts
import { ensureBriefsTable } from "./morning-brief/ensure-table";
```

Inside the `httpServer.listen` callback, immediately after the line `log(\`Auto-fetch scheduled: RSS every ...\`);` (around line 385), add:

```ts
      ensureBriefsTable().catch(err => {
        console.error("Failed to ensure briefs table (non-fatal):", err);
      });
```

- [ ] **Step 6: Typecheck and verify table creation**

```bash
npm run check
```
Expected: no errors.

Start the dev server long enough to run startup, then stop it:

Run: `npm run dev` (watch output, then Ctrl-C)
Expected in output: `[morning-brief] briefs table ready`

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts server/storage.ts server/morning-brief/log.ts server/morning-brief/ensure-table.ts server/index.ts
git commit -m "feat: add briefs table, storage methods, and startup DDL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Config + pure scheduling logic

**Files:**
- Create: `server/morning-brief/config.ts`
- Test: `server/morning-brief/config.test.ts`
- Create: `server/morning-brief/schedule-logic.ts`
- Test: `server/morning-brief/schedule-logic.test.ts`

**Interfaces:**
- Consumes: `type Brief` from `@shared/schema` (type-only).
- Produces:
  - `interface BriefConfig { enabled: boolean; hour: number; timeZone: string; recipients: string[]; appUrl: string; disabledReason?: string }`
  - `getBriefConfig(env?: NodeJS.ProcessEnv): BriefConfig`
  - `zonedParts(now: Date, timeZone: string): { dateStr: string; weekday: number; hour: number }` (weekday 1=Mon … 7=Sun)
  - `shouldRunNow(now: Date, cfg: { hour: number; timeZone: string }): { run: boolean; dateStr: string; reason: string }`
  - `computeWindow(now: Date, prevPeriodEnd: Date | null): { periodStart: Date; periodEnd: Date }` (default 24h back; clamp to 72h max)
  - `nextAction(existing: Pick<Brief, "status" | "attempts"> | undefined, maxAttempts?: number): "compose" | "fallback" | "send" | "done"`

- [ ] **Step 1: Write failing config tests**

Create `server/morning-brief/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getBriefConfig } from "./config";

const fullEnv = {
  RESEND_API_KEY: "re_123",
  BRIEF_RECIPIENTS: "tom@example.com, sara@example.com",
  BRIEF_HOUR: "6",
  BRIEF_TZ: "America/New_York",
  APP_URL: "https://intel.example.com",
} as NodeJS.ProcessEnv;

describe("getBriefConfig", () => {
  it("parses a complete env", () => {
    const cfg = getBriefConfig(fullEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.hour).toBe(6);
    expect(cfg.timeZone).toBe("America/New_York");
    expect(cfg.recipients).toEqual(["tom@example.com", "sara@example.com"]);
    expect(cfg.appUrl).toBe("https://intel.example.com");
  });

  it("applies defaults for hour, tz, appUrl", () => {
    const cfg = getBriefConfig({
      RESEND_API_KEY: "re_123",
      BRIEF_RECIPIENTS: "tom@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg.hour).toBe(7);
    expect(cfg.timeZone).toBe("America/Chicago");
    expect(cfg.appUrl).toBe("http://localhost:5000");
    expect(cfg.enabled).toBe(true);
  });

  it("is disabled without RESEND_API_KEY", () => {
    const cfg = getBriefConfig({ BRIEF_RECIPIENTS: "tom@example.com" } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toContain("RESEND_API_KEY");
  });

  it("is disabled without recipients", () => {
    const cfg = getBriefConfig({ RESEND_API_KEY: "re_123" } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toContain("BRIEF_RECIPIENTS");
  });

  it("ignores empty entries in the recipient list", () => {
    const cfg = getBriefConfig({
      RESEND_API_KEY: "re_123",
      BRIEF_RECIPIENTS: " tom@example.com ,, ",
    } as NodeJS.ProcessEnv);
    expect(cfg.recipients).toEqual(["tom@example.com"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./config`.

- [ ] **Step 3: Implement config**

Create `server/morning-brief/config.ts`:

```ts
export interface BriefConfig {
  enabled: boolean;
  hour: number;
  timeZone: string;
  recipients: string[];
  appUrl: string;
  disabledReason?: string;
}

export function getBriefConfig(env: NodeJS.ProcessEnv = process.env): BriefConfig {
  const recipients = (env.BRIEF_RECIPIENTS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const base = {
    hour: env.BRIEF_HOUR ? parseInt(env.BRIEF_HOUR, 10) : 7,
    timeZone: env.BRIEF_TZ || "America/Chicago",
    recipients,
    appUrl: env.APP_URL || "http://localhost:5000",
  };

  if (!env.RESEND_API_KEY) {
    return { ...base, enabled: false, disabledReason: "RESEND_API_KEY is not set" };
  }
  if (recipients.length === 0) {
    return { ...base, enabled: false, disabledReason: "BRIEF_RECIPIENTS is not set" };
  }
  return { ...base, enabled: true };
}
```

- [ ] **Step 4: Write failing schedule-logic tests**

Create `server/morning-brief/schedule-logic.test.ts`. Date facts used below: 2026-07-06 is a Monday; America/Chicago in July is UTC-5, so `12:00Z = 07:00` Chicago.

```ts
import { describe, it, expect } from "vitest";
import { zonedParts, shouldRunNow, computeWindow, nextAction } from "./schedule-logic";

const CHI = { hour: 7, timeZone: "America/Chicago" };

describe("zonedParts", () => {
  it("converts UTC to Chicago date, weekday, hour", () => {
    // Monday 2026-07-06 12:30 UTC = Monday 07:30 Chicago (CDT, UTC-5)
    const p = zonedParts(new Date("2026-07-06T12:30:00Z"), "America/Chicago");
    expect(p.dateStr).toBe("2026-07-06");
    expect(p.weekday).toBe(1);
    expect(p.hour).toBe(7);
  });

  it("rolls the date across midnight boundaries", () => {
    // 2026-07-07 03:00 UTC = Monday 2026-07-06 22:00 Chicago
    const p = zonedParts(new Date("2026-07-07T03:00:00Z"), "America/Chicago");
    expect(p.dateStr).toBe("2026-07-06");
    expect(p.weekday).toBe(1);
    expect(p.hour).toBe(22);
  });
});

describe("shouldRunNow", () => {
  it("runs on a weekday at/after the hour", () => {
    const r = shouldRunNow(new Date("2026-07-06T12:30:00Z"), CHI); // Mon 07:30
    expect(r.run).toBe(true);
    expect(r.dateStr).toBe("2026-07-06");
  });

  it("does not run before the hour", () => {
    const r = shouldRunNow(new Date("2026-07-06T11:59:00Z"), CHI); // Mon 06:59
    expect(r.run).toBe(false);
  });

  it("does not run on Saturday", () => {
    const r = shouldRunNow(new Date("2026-07-04T13:00:00Z"), CHI); // Sat 08:00
    expect(r.run).toBe(false);
  });

  it("does not run on Sunday", () => {
    const r = shouldRunNow(new Date("2026-07-05T13:00:00Z"), CHI); // Sun 08:00
    expect(r.run).toBe(false);
  });
});

describe("computeWindow", () => {
  const now = new Date("2026-07-06T12:30:00Z");

  it("defaults to 24h back when there is no previous brief", () => {
    const w = computeWindow(now, null);
    expect(w.periodEnd.getTime()).toBe(now.getTime());
    expect(w.periodStart.getTime()).toBe(now.getTime() - 24 * 3600_000);
  });

  it("starts where the previous brief ended", () => {
    const prev = new Date("2026-07-05T12:05:00Z"); // ~24.4h earlier
    const w = computeWindow(now, prev);
    expect(w.periodStart.getTime()).toBe(prev.getTime());
  });

  it("clamps to 72h for long gaps", () => {
    const prev = new Date("2026-07-01T12:05:00Z"); // ~120h earlier
    const w = computeWindow(now, prev);
    expect(w.periodStart.getTime()).toBe(now.getTime() - 72 * 3600_000);
  });
});

describe("nextAction", () => {
  it("composes when no row exists", () => {
    expect(nextAction(undefined)).toBe("compose");
  });
  it("composes again on pending or failed_compose under the attempt cap", () => {
    expect(nextAction({ status: "pending", attempts: 1 })).toBe("compose");
    expect(nextAction({ status: "failed_compose", attempts: 2 })).toBe("compose");
  });
  it("falls back once attempts are exhausted", () => {
    expect(nextAction({ status: "failed_compose", attempts: 3 })).toBe("fallback");
  });
  it("sends when composed, resends on failed_send", () => {
    expect(nextAction({ status: "composed", attempts: 1 })).toBe("send");
    expect(nextAction({ status: "failed_send", attempts: 1 })).toBe("send");
  });
  it("is done after sent or sent_fallback", () => {
    expect(nextAction({ status: "sent", attempts: 1 })).toBe("done");
    expect(nextAction({ status: "sent_fallback", attempts: 3 })).toBe("done");
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./schedule-logic`.

- [ ] **Step 6: Implement schedule-logic**

Create `server/morning-brief/schedule-logic.ts`:

```ts
import type { Brief } from "@shared/schema";

const WEEKDAY_NUM: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

export function zonedParts(
  now: Date,
  timeZone: string,
): { dateStr: string; weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_NUM[parts.weekday],
    // Some ICU versions emit "24" for midnight with hour12: false
    hour: parseInt(parts.hour, 10) % 24,
  };
}

export function shouldRunNow(
  now: Date,
  cfg: { hour: number; timeZone: string },
): { run: boolean; dateStr: string; reason: string } {
  const p = zonedParts(now, cfg.timeZone);
  if (p.weekday >= 6) {
    return { run: false, dateStr: p.dateStr, reason: "weekend" };
  }
  if (p.hour < cfg.hour) {
    return { run: false, dateStr: p.dateStr, reason: `before ${cfg.hour}:00 ${cfg.timeZone}` };
  }
  return { run: true, dateStr: p.dateStr, reason: "due" };
}

const HOUR_MS = 3600_000;

export function computeWindow(
  now: Date,
  prevPeriodEnd: Date | null,
): { periodStart: Date; periodEnd: Date } {
  const floor = now.getTime() - 72 * HOUR_MS;
  const start = prevPeriodEnd
    ? Math.max(prevPeriodEnd.getTime(), floor)
    : now.getTime() - 24 * HOUR_MS;
  return { periodStart: new Date(start), periodEnd: now };
}

export function nextAction(
  existing: Pick<Brief, "status" | "attempts"> | undefined,
  maxAttempts = 3,
): "compose" | "fallback" | "send" | "done" {
  if (!existing) return "compose";
  switch (existing.status) {
    case "pending":
    case "failed_compose":
      return existing.attempts < maxAttempts ? "compose" : "fallback";
    case "composed":
    case "failed_send":
      return "send";
    case "sent":
    case "sent_fallback":
      return "done";
    default:
      return "done";
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all config + schedule-logic + brief-payload tests.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run check
git add server/morning-brief/config.ts server/morning-brief/config.test.ts server/morning-brief/schedule-logic.ts server/morning-brief/schedule-logic.test.ts
git commit -m "feat: add morning brief config and pure scheduling logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Composer (inputs → Claude → BriefPayload)

**Files:**
- Create: `server/morning-brief/composer.ts`
- Test: `server/morning-brief/composer.test.ts`

**Interfaces:**
- Consumes: `storage` (`getArticlesByDateRange(startDate: Date, endDate: Date, category?: string)`, `getCompetitors()`, `getLatestTrendSnapshot()`, `getTrendSnapshots(limit)`), `getDemandbaseContext()` from `server/demandbase-context`, `chatCompletion` + `ChatMessage` from `server/ai-models`, `briefPayloadSchema`/`BriefPayload` from `@shared/brief-payload`, `computeWindow` output shape from Task 3.
- Produces:
  - `interface ComposerInputs { dateStr: string; window: { periodStart: Date; periodEnd: Date }; articles: Article[]; competitorCandidates: Array<{ name: string; articleIds: number[] }>; latestSnapshot: TrendSnapshot | null; previousSnapshot: TrendSnapshot | null; dbContext: string }`
  - `gatherInputs(dateStr: string, window: { periodStart: Date; periodEnd: Date }): Promise<ComposerInputs>`
  - `matchCompetitors(articles: Article[], competitors: Competitor[]): Array<{ name: string; articleIds: number[] }>`
  - `buildBriefPrompt(inputs: ComposerInputs): { system: string; user: string }`
  - `extractJson(raw: string): string`
  - `composeBrief(inputs: ComposerInputs, chat?: typeof chatCompletion): Promise<BriefPayload>` — one repair pass; throws `Error` whose message starts with `Brief composition failed` on second validation failure.
  - `const BRIEF_MODEL = "claude-sonnet-4-6"`

- [ ] **Step 1: Write failing tests**

Create `server/morning-brief/composer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// ai-models instantiates SDK clients at module load; mock so tests never need API keys
vi.mock("../ai-models", () => ({ chatCompletion: vi.fn() }));

import { matchCompetitors, buildBriefPrompt, extractJson, composeBrief, type ComposerInputs } from "./composer";
import type { Article, Competitor } from "@shared/schema";

function art(id: number, title: string, description = ""): Article {
  return {
    id, title, description,
    link: `https://example.com/${id}`,
    content: null, author: null,
    publishedAt: new Date("2026-07-02T08:00:00Z"),
    sourceId: null, sourceName: "Example Source", category: "GTM Tech",
    imageUrl: null, isRead: false, dismissed: false, dismissedAt: null,
    createdAt: new Date("2026-07-02T08:00:00Z"),
  } as Article;
}

function comp(name: string): Competitor {
  return { id: 1, name } as Competitor;
}

const validPayload = {
  date: "2026-07-02",
  headline: "Test headline",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [{
    title: "Story", whyItMatters: "Matters.", sourceName: "Example Source",
    link: "https://example.com/1", articleId: 1,
  }],
  competitorWatch: [], trendPulse: [], radar: [], quietDay: true,
};

function inputs(overrides: Partial<ComposerInputs> = {}): ComposerInputs {
  return {
    dateStr: "2026-07-02",
    window: { periodStart: new Date("2026-07-01T12:00:00Z"), periodEnd: new Date("2026-07-02T12:00:00Z") },
    articles: [art(1, "6sense launches usage-based pricing", "Big ABM pricing shift")],
    competitorCandidates: [{ name: "6sense", articleIds: [1] }],
    latestSnapshot: null, previousSnapshot: null,
    dbContext: "Demandbase is a GTM platform.",
    ...overrides,
  };
}

describe("matchCompetitors", () => {
  it("matches competitor names in title or description, case-insensitive", () => {
    const articles = [art(1, "6SENSE raises prices"), art(2, "Nothing here"), art(3, "About clearbit data", "clearbit expands")];
    const comps = [comp("6sense"), comp("Clearbit (HubSpot)"), comp("Bombora")];
    const out = matchCompetitors(articles, comps);
    expect(out).toEqual([
      { name: "6sense", articleIds: [1] },
      { name: "Clearbit (HubSpot)", articleIds: [3] },
    ]);
  });

  it("strips parenthetical suffixes when matching", () => {
    const out = matchCompetitors([art(9, "Terminus ships new ABM feature")], [comp("Terminus (DemandScience)")]);
    expect(out).toEqual([{ name: "Terminus (DemandScience)", articleIds: [9] }]);
  });
});

describe("buildBriefPrompt", () => {
  it("includes articles, competitor candidates, context, date, and the JSON contract", () => {
    const { system, user } = buildBriefPrompt(inputs());
    expect(system).toContain("strict JSON");
    expect(system).toContain("dbAngle");
    expect(user).toContain("6sense launches usage-based pricing");
    expect(user).toContain("[1]"); // article id marker
    expect(user).toContain("2026-07-02");
    expect(user).toContain("Demandbase is a GTM platform.");
  });
});

describe("extractJson", () => {
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the outermost object from surrounding prose", () => {
    expect(extractJson('Here you go: {"a":1} hope that helps')).toBe('{"a":1}');
  });
});

describe("composeBrief", () => {
  it("returns the payload when the first response is valid", async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify(validPayload));
    const result = await composeBrief(inputs(), chat as any);
    expect(result.headline).toBe("Test headline");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("runs one repair pass when the first response is invalid", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce('{"broken": true}')
      .mockResolvedValueOnce(JSON.stringify(validPayload));
    const result = await composeBrief(inputs(), chat as any);
    expect(result.headline).toBe("Test headline");
    expect(chat).toHaveBeenCalledTimes(2);
    const repairMessages = chat.mock.calls[1][0].messages;
    expect(JSON.stringify(repairMessages)).toContain("invalid");
  });

  it("throws after the repair pass also fails", async () => {
    const chat = vi.fn().mockResolvedValue('{"broken": true}');
    await expect(composeBrief(inputs(), chat as any)).rejects.toThrow(/Brief composition failed/);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./composer`.

- [ ] **Step 3: Implement the composer**

Create `server/morning-brief/composer.ts`:

```ts
import type { Article, Competitor, TrendSnapshot } from "@shared/schema";
import { briefPayloadSchema, type BriefPayload } from "@shared/brief-payload";
import { storage } from "../storage";
import { getDemandbaseContext } from "../demandbase-context";
import { chatCompletion } from "../ai-models";
import { blog } from "./log";

export const BRIEF_MODEL = "claude-sonnet-4-6";
const MAX_ARTICLES = 120;

export interface ComposerInputs {
  dateStr: string;
  window: { periodStart: Date; periodEnd: Date };
  articles: Article[];
  competitorCandidates: Array<{ name: string; articleIds: number[] }>;
  latestSnapshot: TrendSnapshot | null;
  previousSnapshot: TrendSnapshot | null;
  dbContext: string;
}

export function matchCompetitors(
  articles: Article[],
  competitors: Competitor[],
): Array<{ name: string; articleIds: number[] }> {
  const out: Array<{ name: string; articleIds: number[] }> = [];
  for (const c of competitors) {
    const needle = c.name.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
    if (!needle) continue;
    const ids = articles
      .filter(a => {
        const hay = `${a.title} ${a.description || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .map(a => a.id);
    if (ids.length > 0) out.push({ name: c.name, articleIds: ids });
  }
  return out;
}

export async function gatherInputs(
  dateStr: string,
  window: { periodStart: Date; periodEnd: Date },
): Promise<ComposerInputs> {
  const [rawArticles, competitors, snapshots, dbContext] = await Promise.all([
    storage.getArticlesByDateRange(window.periodStart, window.periodEnd),
    storage.getCompetitors(),
    storage.getTrendSnapshots(2),
    getDemandbaseContext(),
  ]);
  const articles = rawArticles
    .filter(a => !a.dismissed)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, MAX_ARTICLES);
  blog(`gathered ${articles.length} articles for ${dateStr} window`);
  return {
    dateStr,
    window,
    articles,
    competitorCandidates: matchCompetitors(articles, competitors),
    latestSnapshot: snapshots[0] ?? null,
    previousSnapshot: snapshots[1] ?? null,
    dbContext,
  };
}

export function buildBriefPrompt(inputs: ComposerInputs): { system: string; user: string } {
  const system = `You are the intelligence editor for Demandbase's GTM team. Each weekday morning you compose a brief that makes the reader fully current on B2B/MarTech in a 3-minute read (~500 words total).

Return ONLY strict JSON (no markdown fences, no prose) with exactly this shape:
{
  "date": "YYYY-MM-DD",
  "headline": "the day in one line, <= 12 words",
  "periodStart": "ISO timestamp", "periodEnd": "ISO timestamp",
  "topStories": [3-5 items, fewer only on quiet days: {
    "title": "...", "whyItMatters": "1-2 sentences, <= 40 words",
    "dbAngle": OMIT unless genuine: { "strength": "strong"|"moderate", "text": "<= 30 words" },
    "sourceName": "...", "link": "original article URL", "articleId": <id from the list>
  }],
  "competitorWatch": [{ "competitor": "...", "summary": "<= 30 words", "links": [{"title","url"}] }],
  "trendPulse": [{ "trend": "...", "direction": "rising"|"cooling", "note": "<= 20 words" }],
  "radar": [5-8 one-liners: { "title": "...", "sourceName": "...", "link": "..." }],
  "contentIdea": OMIT or at most one: { "title": "...", "description": "<= 25 words", "deepLink": "/thought-leadership" },
  "quietDay": boolean
}

Rules:
- dbAngle HONESTY: include one only when the story genuinely intersects Demandbase's business. Most stories should have NO dbAngle. Never manufacture relevance.
- Select stories by significance to B2B GTM professionals, not recency alone. No duplicate coverage of one event across topStories and radar.
- trendPulse: only movements you can infer by comparing the two snapshots; empty array if no snapshot data.
- competitorWatch: only from the provided candidates; empty array if none are genuinely newsworthy.
- quietDay: set true when fewer than 3 substantive stories exist; then include only what's real (1-2 stories is fine) and keep everything shorter.
- Every articleId and link must come from the provided article list.`;

  const articleLines = inputs.articles
    .map(a => `[${a.id}] ${a.title} — ${a.sourceName || "unknown"} — ${a.category || "uncategorized"} — ${a.link}${a.description ? ` — ${a.description.slice(0, 300)}` : ""}`)
    .join("\n");
  const competitorLines = inputs.competitorCandidates.length
    ? inputs.competitorCandidates.map(c => `${c.name}: article ids ${c.articleIds.join(", ")}`).join("\n")
    : "none detected in this window";

  const user = `Date: ${inputs.dateStr}
Window: ${inputs.window.periodStart.toISOString()} to ${inputs.window.periodEnd.toISOString()}

=== DEMANDBASE CONTEXT (for dbAngle judgment) ===
${inputs.dbContext.slice(0, 4000)}

=== COMPETITOR CANDIDATES ===
${competitorLines}

=== LATEST TREND SNAPSHOT ===
${inputs.latestSnapshot ? inputs.latestSnapshot.trends.slice(0, 1500) : "none"}

=== PREVIOUS TREND SNAPSHOT ===
${inputs.previousSnapshot ? inputs.previousSnapshot.trends.slice(0, 800) : "none"}

=== ARTICLES (${inputs.articles.length}) ===
${articleLines}

Compose today's brief JSON now.`;

  return { system, user };
}

export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function tryParse(raw: string): { ok: true; data: BriefPayload } | { ok: false; issues: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch (e: any) {
    return { ok: false, issues: `JSON.parse error: ${e.message}` };
  }
  const parsed = briefPayloadSchema.safeParse(obj);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}

export async function composeBrief(
  inputs: ComposerInputs,
  chat: typeof chatCompletion = chatCompletion,
): Promise<BriefPayload> {
  const { system, user } = buildBriefPrompt(inputs);
  const started = Date.now();
  const first = await chat({
    model: BRIEF_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 4096,
    jsonMode: true,
  });
  let attempt = tryParse(first);
  if (attempt.ok) {
    blog(`composed brief in ${Date.now() - started}ms (first pass)`);
    return attempt.data;
  }

  blog(`compose output invalid, running repair pass: ${attempt.issues.slice(0, 200)}`);
  const second = await chat({
    model: BRIEF_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: first },
      {
        role: "user",
        content: `That JSON was invalid: ${attempt.issues}. Return the corrected strict JSON only — no fences, no commentary.`,
      },
    ],
    maxTokens: 4096,
    jsonMode: true,
  });
  attempt = tryParse(second);
  if (attempt.ok) {
    blog(`composed brief in ${Date.now() - started}ms (repair pass)`);
    return attempt.data;
  }
  throw new Error(`Brief composition failed schema validation after repair pass: ${attempt.issues}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check
git add server/morning-brief/composer.ts server/morning-brief/composer.test.ts
git commit -m "feat: add morning brief composer with repair pass

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Email renderer (payload → subject/html/text, + fallback)

**Files:**
- Create: `server/morning-brief/render-email.ts`
- Test: `server/morning-brief/render-email.test.ts`

**Interfaces:**
- Consumes: `BriefPayload` from `@shared/brief-payload`, `Article` type, `format`/`parseISO` from `date-fns`.
- Produces:
  - `interface RenderedEmail { subject: string; html: string; text: string }`
  - `renderBriefEmail(payload: BriefPayload, appUrl: string): RenderedEmail`
  - `renderFallbackEmail(articles: Article[], dateStr: string, appUrl: string): RenderedEmail` (caps at 10 articles)
  - `esc(s: string): string` (HTML entity escaping)

- [ ] **Step 1: Write failing tests**

Create `server/morning-brief/render-email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderBriefEmail, renderFallbackEmail, esc } from "./render-email";
import type { BriefPayload } from "@shared/brief-payload";
import type { Article } from "@shared/schema";

const base: BriefPayload = {
  date: "2026-07-02",
  headline: "6sense reprices & CDPs consolidate",
  periodStart: "2026-07-01T12:00:00.000Z",
  periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [
    {
      title: "6sense <launches> pricing",
      whyItMatters: "Reshapes deal economics.",
      dbAngle: { strength: "strong", text: "Counter on transparency." },
      sourceName: "TechCrunch",
      link: "https://techcrunch.com/x",
      articleId: 1,
    },
    {
      title: "Plain story",
      whyItMatters: "Context only.",
      sourceName: "MarTech",
      link: "https://martech.example/y",
      articleId: 2,
    },
  ],
  competitorWatch: [
    { competitor: "6sense", summary: "Pricing move.", links: [{ title: "coverage", url: "https://a.example" }] },
  ],
  trendPulse: [{ trend: "CDP consolidation", direction: "rising", note: "Third deal this month." }],
  radar: [{ title: "HubSpot ships agents", sourceName: "MarTech Today", link: "https://b.example" }],
  contentIdea: { title: "Pricing hot take", description: "LinkedIn post.", deepLink: "/thought-leadership" },
  quietDay: false,
};

describe("esc", () => {
  it("escapes HTML entities", () => {
    expect(esc(`<script>"a" & 'b'</script>`)).toBe(
      "&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;",
    );
  });
});

describe("renderBriefEmail", () => {
  it("builds the subject in the spec format", () => {
    const { subject } = renderBriefEmail(base, "https://app.example.com");
    expect(subject).toBe("GTM Brief · Thu Jul 2 — 6sense reprices & CDPs consolidate");
  });

  it("escapes story titles in html", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("6sense &lt;launches&gt; pricing");
    expect(html).not.toContain("<launches>");
  });

  it("renders the angle callout only for stories that have one", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html.match(/Demandbase angle/g)?.length).toBe(1);
  });

  it("renders all section headings when populated", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("Competitor watch");
    expect(html).toContain("Trend pulse");
    expect(html).toContain("Radar");
    expect(html).toContain("Content idea");
  });

  it("omits empty sections entirely", () => {
    const empty: BriefPayload = { ...base, competitorWatch: [], trendPulse: [], radar: [], contentIdea: undefined };
    const { html } = renderBriefEmail(empty, "https://app.example.com");
    expect(html).not.toContain("Competitor watch");
    expect(html).not.toContain("Trend pulse");
    expect(html).not.toContain("Radar");
    expect(html).not.toContain("Content idea");
  });

  it("marks quiet days in the greeting", () => {
    const quiet = { ...base, quietDay: true };
    const { html, text } = renderBriefEmail(quiet, "https://app.example.com");
    expect(html).toContain("Quiet day");
    expect(text).toContain("Quiet day");
  });

  it("includes app deep links and dashboard button", () => {
    const { html } = renderBriefEmail(base, "https://app.example.com");
    expect(html).toContain("https://app.example.com/thought-leadership");
    expect(html).toContain("https://app.example.com/morning-brief");
  });

  it("produces a text version with story titles", () => {
    const { text } = renderBriefEmail(base, "https://app.example.com");
    expect(text).toContain("6sense <launches> pricing");
    expect(text).toContain("https://techcrunch.com/x");
  });
});

describe("renderFallbackEmail", () => {
  function art(id: number, title: string): Article {
    return {
      id, title, link: `https://example.com/${id}`, description: null, content: null,
      author: null, publishedAt: new Date("2026-07-02T08:00:00Z"), sourceId: null,
      sourceName: "Src", category: "AI", imageUrl: null, isRead: false,
      dismissed: false, dismissedAt: null, createdAt: new Date(),
    } as Article;
  }

  it("lists at most 10 headlines and says generation failed", () => {
    const arts = Array.from({ length: 14 }, (_, i) => art(i + 1, `Story ${i + 1}`));
    const { subject, html } = renderFallbackEmail(arts, "2026-07-02", "https://app.example.com");
    expect(subject).toContain("GTM Brief");
    expect(html).toContain("Story 10");
    expect(html).not.toContain("Story 11");
    expect(html.toLowerCase()).toContain("couldn&#39;t be generated");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./render-email`.

- [ ] **Step 3: Implement the renderer**

Create `server/morning-brief/render-email.ts`:

```ts
import { format, parseISO } from "date-fns";
import type { BriefPayload } from "@shared/brief-payload";
import type { Article } from "@shared/schema";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const MIDNIGHT = "#0D1846";
const ORANGE = "#F26B43";
const ANGLE_BG = "#FFF3EE";
const INK = "#1a2333";
const MUTED = "#5a6478";
const RULE = "#e5e8ef";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dayLabel(dateStr: string): string {
  return format(parseISO(dateStr), "EEE MMM d");
}

function shell(dateStr: string, bodyHtml: string, appUrl: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${MIDNIGHT};padding:20px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">GTM Brief</span>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9fb0d8;padding-left:10px;">${esc(dayLabel(dateStr))}</span>
</td></tr>
${bodyHtml}
<tr><td style="padding:24px 28px 8px 28px;" align="center">
  <a href="${appUrl}/morning-brief" style="display:inline-block;background:${ORANGE};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:10px 22px;border-radius:6px;">Open dashboard &rarr;</a>
</td></tr>
<tr><td style="padding:8px 28px 24px 28px;" align="center">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">B2B MarTech Intel &middot; weekday mornings</span>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function sectionHeading(label: string): string {
  return `<tr><td style="padding:22px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.4px;color:${MUTED};text-transform:uppercase;">${esc(label)}</span>
</td></tr>`;
}

export function renderBriefEmail(payload: BriefPayload, appUrl: string): RenderedEmail {
  const subject = `GTM Brief · ${dayLabel(payload.date)} — ${payload.headline}`;
  const parts: string[] = [];
  const textParts: string[] = [];

  const greeting = payload.quietDay
    ? `Quiet day — ${payload.topStories.length} ${payload.topStories.length === 1 ? "story" : "stories"} worth your time.`
    : payload.headline;
  parts.push(`<tr><td style="padding:22px 28px 0 28px;">
  <span style="font-family:Georgia,serif;font-size:20px;line-height:1.35;color:${INK};font-weight:bold;">${esc(greeting)}</span>
</td></tr>`);
  textParts.push(`GTM BRIEF — ${dayLabel(payload.date)}`, greeting, "");

  parts.push(sectionHeading("Top stories"));
  textParts.push("TOP STORIES");
  for (const s of payload.topStories) {
    const angle = s.dbAngle
      ? `<div style="background:${ANGLE_BG};border-radius:6px;padding:10px 14px;margin-top:8px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.4px;color:${ORANGE};text-transform:uppercase;">Demandbase angle${s.dbAngle.strength === "moderate" ? " (moderate)" : ""}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${INK};padding-top:3px;">${esc(s.dbAngle.text)}</div>
</div>`
      : "";
    parts.push(`<tr><td style="padding:12px 28px 4px 28px;border-bottom:1px solid ${RULE};">
  <a href="${esc(s.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${MIDNIGHT};text-decoration:none;">${esc(s.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(s.sourceName)}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${INK};padding:5px 0 12px 0;">${esc(s.whyItMatters)}</div>
  ${angle}
  <div style="height:10px;"></div>
</td></tr>`);
    textParts.push(`- ${s.title} (${s.sourceName})`, `  ${s.whyItMatters}`, `  ${s.link}`);
    if (s.dbAngle) textParts.push(`  DB ANGLE: ${s.dbAngle.text}`);
  }
  textParts.push("");

  if (payload.competitorWatch.length > 0) {
    parts.push(sectionHeading("Competitor watch"));
    textParts.push("COMPETITOR WATCH");
    for (const c of payload.competitorWatch) {
      const links = c.links
        .map(l => `<a href="${esc(l.url)}" style="color:${MIDNIGHT};font-size:12px;">${esc(l.title)}</a>`)
        .join(" &middot; ");
      parts.push(`<tr><td style="padding:10px 28px 6px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${INK};">${esc(c.competitor)}</span>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"> — ${esc(c.summary)}</span>
  <div style="font-family:Arial,Helvetica,sans-serif;padding-top:2px;">${links}</div>
</td></tr>`);
      textParts.push(`- ${c.competitor}: ${c.summary}`);
    }
    textParts.push("");
  }

  if (payload.trendPulse.length > 0) {
    parts.push(sectionHeading("Trend pulse"));
    textParts.push("TREND PULSE");
    for (const t of payload.trendPulse) {
      const arrow = t.direction === "rising" ? "&#9650;" : "&#9660;";
      parts.push(`<tr><td style="padding:8px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"><b>${arrow} ${esc(t.trend)}</b> — ${esc(t.note)}</span>
</td></tr>`);
      textParts.push(`- ${t.direction === "rising" ? "UP" : "DOWN"} ${t.trend}: ${t.note}`);
    }
    textParts.push("");
  }

  if (payload.radar.length > 0) {
    parts.push(sectionHeading("Radar"));
    textParts.push("RADAR");
    for (const r of payload.radar) {
      parts.push(`<tr><td style="padding:6px 28px 2px 28px;">
  <a href="${esc(r.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};text-decoration:underline;">${esc(r.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(r.sourceName)}</span>
</td></tr>`);
      textParts.push(`- ${r.title} (${r.sourceName}) ${r.link}`);
    }
    textParts.push("");
  }

  if (payload.contentIdea) {
    parts.push(sectionHeading("Content idea"));
    parts.push(`<tr><td style="padding:8px 28px 4px 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${INK};"><b>${esc(payload.contentIdea.title)}</b> — ${esc(payload.contentIdea.description)}</span>
  <div style="padding-top:4px;"><a href="${appUrl}${esc(payload.contentIdea.deepLink)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MIDNIGHT};font-weight:bold;">Create &rarr;</a></div>
</td></tr>`);
    textParts.push("CONTENT IDEA", `- ${payload.contentIdea.title}: ${payload.contentIdea.description}`, "");
  }

  return {
    subject,
    html: shell(payload.date, parts.join("\n"), appUrl),
    text: textParts.join("\n"),
  };
}

export function renderFallbackEmail(
  articles: Article[],
  dateStr: string,
  appUrl: string,
): RenderedEmail {
  const top = articles.filter(a => !a.dismissed).slice(0, 10);
  const subject = `GTM Brief · ${dayLabel(dateStr)} — this morning's headlines`;
  const items = top
    .map(
      a => `<tr><td style="padding:7px 28px 3px 28px;">
  <a href="${esc(a.link)}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};text-decoration:underline;">${esc(a.title)}</a>
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};"> &middot; ${esc(a.sourceName || "unknown")}</span>
</td></tr>`,
    )
    .join("\n");
  const body = `<tr><td style="padding:22px 28px 0 28px;">
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${INK};">Today&#39;s brief couldn&#39;t be generated, so here are the morning&#39;s top headlines instead.</span>
</td></tr>
${sectionHeading("Headlines")}
${items}`;
  const text = [
    `GTM BRIEF — ${dayLabel(dateStr)}`,
    "Today's brief couldn't be generated; top headlines below.",
    "",
    ...top.map(a => `- ${a.title} (${a.sourceName || "unknown"}) ${a.link}`),
  ].join("\n");
  return { subject, html: shell(dateStr, body, appUrl), text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check
git add server/morning-brief/render-email.ts server/morning-brief/render-email.test.ts
git commit -m "feat: add morning brief email renderer with fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Delivery via Resend + .env.example

**Files:**
- Create: `server/morning-brief/deliver.ts`
- Test: `server/morning-brief/deliver.test.ts`
- Modify: `.env.example` (append new vars)
- Modify: `package.json` (install `resend`)

**Interfaces:**
- Consumes: `RenderedEmail` from Task 5, `getBriefConfig` from Task 3, `p-retry` (existing dep), `resend` SDK.
- Produces: `sendEmail(email: RenderedEmail, to: string[], deps?: { client?: EmailClient; retries?: number }): Promise<{ id: string }>` where `interface EmailClient { send(args: { from: string; to: string[]; subject: string; html: string; text: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }> }`. Throws `Error` with message starting `Email delivery failed` after retries exhaust.

- [ ] **Step 1: Install resend**

```bash
npm install resend
```

- [ ] **Step 2: Write failing tests**

Create `server/morning-brief/deliver.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "./deliver";

const email = { subject: "s", html: "<p>h</p>", text: "t" };

describe("sendEmail", () => {
  it("sends via the client and returns the id", async () => {
    const client = { send: vi.fn().mockResolvedValue({ data: { id: "em_1" }, error: null }) };
    const result = await sendEmail(email, ["tom@example.com"], { client, retries: 0 });
    expect(result.id).toBe("em_1");
    expect(client.send).toHaveBeenCalledWith({
      from: "GTM Brief <onboarding@resend.dev>",
      to: ["tom@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("retries on failure then succeeds", async () => {
    const client = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: "rate limited" } })
        .mockResolvedValueOnce({ data: { id: "em_2" }, error: null }),
    };
    const result = await sendEmail(email, ["tom@example.com"], { client, retries: 2 });
    expect(result.id).toBe("em_2");
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("throws a labeled error after retries exhaust", async () => {
    const client = { send: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) };
    await expect(sendEmail(email, ["tom@example.com"], { client, retries: 1 })).rejects.toThrow(
      /Email delivery failed.*boom/,
    );
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./deliver`.

- [ ] **Step 4: Implement delivery**

Create `server/morning-brief/deliver.ts`:

```ts
import { Resend } from "resend";
import pRetry from "p-retry";
import type { RenderedEmail } from "./render-email";
import { blog } from "./log";

const FROM = "GTM Brief <onboarding@resend.dev>";

export interface EmailClient {
  send(args: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
}

function resendClient(): EmailClient {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    send: args => resend.emails.send(args) as ReturnType<EmailClient["send"]>,
  };
}

export async function sendEmail(
  email: RenderedEmail,
  to: string[],
  deps: { client?: EmailClient; retries?: number } = {},
): Promise<{ id: string }> {
  const client = deps.client ?? resendClient();
  const retries = deps.retries ?? 3;
  try {
    return await pRetry(
      async () => {
        const { data, error } = await client.send({
          from: FROM,
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
        if (error || !data) {
          throw new Error(error?.message || "Resend returned no data");
        }
        blog(`email sent to ${to.join(", ")} (id ${data.id})`);
        return { id: data.id };
      },
      { retries, minTimeout: 1000 },
    );
  } catch (err: any) {
    throw new Error(`Email delivery failed after ${retries + 1} attempts: ${err.message}`);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 6: Update `.env.example`**

Append to `.env.example`:

```
# Morning Brief (push email)
RESEND_API_KEY=
BRIEF_RECIPIENTS=you@example.com
BRIEF_HOUR=7
BRIEF_TZ=America/Chicago
APP_URL=http://localhost:5000
```

- [ ] **Step 7: Typecheck and commit**

```bash
npm run check
git add package.json package-lock.json server/morning-brief/deliver.ts server/morning-brief/deliver.test.ts .env.example
git commit -m "feat: add Resend email delivery with retries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Scheduler, status machine execution, index.ts wiring

**Files:**
- Create: `server/morning-brief/scheduler.ts`
- Test: `server/morning-brief/scheduler.test.ts`
- Modify: `server/index.ts` (start the scheduler)

**Interfaces:**
- Consumes: everything from Tasks 2-6 (`storage` brief methods, `getBriefConfig`, `shouldRunNow`, `computeWindow`, `nextAction`, `gatherInputs`, `composeBrief`, `renderBriefEmail`, `renderFallbackEmail`, `sendEmail`, `blog`), plus `type Brief`, `briefPayloadSchema`.
- Produces:
  - `interface PipelineDeps { compose: typeof composeBrief; send: typeof sendEmail }` (defaulted; tests inject fakes)
  - `executeAction(brief: Brief, action: "compose" | "fallback" | "send", cfg: BriefConfig, deps?: Partial<PipelineDeps>): Promise<Brief>`
  - `briefTick(now?: Date, deps?: Partial<PipelineDeps>): Promise<void>`
  - `runManualBrief(deps?: Partial<PipelineDeps>): Promise<Brief>` — throws on compose/send failure (no fallback for manual runs)
  - `startBriefScheduler(): void` — 5-minute `setInterval`, logs once if disabled

- [ ] **Step 1: Write failing tests**

Create `server/morning-brief/scheduler.test.ts`. These tests mock the storage module and drive `executeAction` through the status machine:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Brief } from "@shared/schema";

vi.mock("../storage", () => ({
  storage: {
    updateBrief: vi.fn(),
    getArticlesByDateRange: vi.fn().mockResolvedValue([]),
    getCompetitors: vi.fn().mockResolvedValue([]),
    getTrendSnapshots: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../demandbase-context", () => ({
  getDemandbaseContext: vi.fn().mockResolvedValue("ctx"),
}));
// ai-models instantiates SDK clients at module load; mock so tests never need API keys
vi.mock("../ai-models", () => ({ chatCompletion: vi.fn() }));

import { executeAction } from "./scheduler";
import { storage } from "../storage";

const cfg = {
  enabled: true, hour: 7, timeZone: "America/Chicago",
  recipients: ["tom@example.com"], appUrl: "https://app.example.com",
};

const validPayload = {
  date: "2026-07-02", headline: "H",
  periodStart: "2026-07-01T12:00:00.000Z", periodEnd: "2026-07-02T12:00:00.000Z",
  topStories: [{ title: "T", whyItMatters: "W", sourceName: "S", link: "https://e.com/1", articleId: 1 }],
  competitorWatch: [], trendPulse: [], radar: [], quietDay: true,
};

function row(overrides: Partial<Brief> = {}): Brief {
  return {
    id: 10, briefDate: "2026-07-02", manual: false,
    periodStart: new Date("2026-07-01T12:00:00Z"), periodEnd: new Date("2026-07-02T12:00:00Z"),
    payload: null, status: "pending", attempts: 0, error: null, sentAt: null,
    createdAt: new Date(), ...overrides,
  } as Brief;
}

beforeEach(() => {
  vi.mocked(storage.updateBrief).mockImplementation(async (_id, data) => row(data as any));
});

describe("executeAction", () => {
  it("compose success → composed → sent", async () => {
    const compose = vi.fn().mockResolvedValue(validPayload);
    const send = vi.fn().mockResolvedValue({ id: "em_1" });
    await executeAction(row(), "compose", cfg, { compose, send });
    const statuses = vi.mocked(storage.updateBrief).mock.calls.map(c => (c[1] as any).status).filter(Boolean);
    expect(statuses).toContain("composed");
    expect(statuses[statuses.length - 1]).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("compose failure → failed_compose with attempts incremented and error stored", async () => {
    const compose = vi.fn().mockRejectedValue(new Error("claude down"));
    const send = vi.fn();
    await executeAction(row({ attempts: 1 }), "compose", cfg, { compose, send });
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("failed_compose");
    expect(last.error).toContain("claude down");
    const attemptsUpdate = vi.mocked(storage.updateBrief).mock.calls.find(c => (c[1] as any).attempts !== undefined)![1] as any;
    expect(attemptsUpdate.attempts).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("send action re-renders the stored payload without recomposing", async () => {
    const compose = vi.fn();
    const send = vi.fn().mockResolvedValue({ id: "em_2" });
    await executeAction(row({ status: "failed_send", payload: JSON.stringify(validPayload) }), "send", cfg, { compose, send });
    expect(compose).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("sent");
  });

  it("send failure → failed_send with error stored", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend 500"));
    await executeAction(row({ status: "composed", payload: JSON.stringify(validPayload) }), "send", cfg, { send });
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("failed_send");
    expect(last.error).toContain("resend 500");
  });

  it("fallback → sends headline email → sent_fallback", async () => {
    const send = vi.fn().mockResolvedValue({ id: "em_3" });
    await executeAction(row({ status: "failed_compose", attempts: 3 }), "fallback", cfg, { send });
    expect(send).toHaveBeenCalledTimes(1);
    const sentEmail = send.mock.calls[0][0];
    expect(sentEmail.subject).toContain("headlines");
    const last = vi.mocked(storage.updateBrief).mock.calls.at(-1)![1] as any;
    expect(last.status).toBe("sent_fallback");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot find `./scheduler`.

- [ ] **Step 3: Implement the scheduler**

Create `server/morning-brief/scheduler.ts`:

```ts
import { storage } from "../storage";
import type { Brief } from "@shared/schema";
import { briefPayloadSchema } from "@shared/brief-payload";
import { getBriefConfig, type BriefConfig } from "./config";
import { shouldRunNow, computeWindow, nextAction, zonedParts } from "./schedule-logic";
import { gatherInputs, composeBrief } from "./composer";
import { renderBriefEmail, renderFallbackEmail } from "./render-email";
import { sendEmail } from "./deliver";
import { blog } from "./log";

const TICK_MS = 5 * 60 * 1000;

export interface PipelineDeps {
  compose: typeof composeBrief;
  send: typeof sendEmail;
}

function deps(partial: Partial<PipelineDeps> = {}): PipelineDeps {
  return { compose: partial.compose ?? composeBrief, send: partial.send ?? sendEmail };
}

async function sendStored(brief: Brief, cfg: BriefConfig, d: PipelineDeps): Promise<Brief> {
  try {
    let email;
    if (brief.payload) {
      const payload = briefPayloadSchema.parse(JSON.parse(brief.payload));
      email = renderBriefEmail(payload, cfg.appUrl);
    } else {
      // Fallback content: last 24h of headlines, fetched fresh
      const now = new Date();
      const articles = await storage.getArticlesByDateRange(
        new Date(now.getTime() - 24 * 3600_000),
        now,
      );
      email = renderFallbackEmail(articles, brief.briefDate, cfg.appUrl);
    }
    await d.send(email, cfg.recipients);
    const status = brief.payload ? "sent" : "sent_fallback";
    blog(`brief ${brief.id} (${brief.briefDate}) ${status}`);
    return (await storage.updateBrief(brief.id, { status, sentAt: new Date(), error: null }))!;
  } catch (err: any) {
    blog(`brief ${brief.id} send failed: ${err.message}`);
    return (await storage.updateBrief(brief.id, { status: "failed_send", error: err.message }))!;
  }
}

export async function executeAction(
  brief: Brief,
  action: "compose" | "fallback" | "send",
  cfg: BriefConfig,
  partialDeps: Partial<PipelineDeps> = {},
): Promise<Brief> {
  const d = deps(partialDeps);

  if (action === "compose") {
    await storage.updateBrief(brief.id, { attempts: brief.attempts + 1 });
    try {
      blog(`composing brief for ${brief.briefDate} (attempt ${brief.attempts + 1})`);
      const inputs = await gatherInputs(brief.briefDate, {
        periodStart: brief.periodStart!,
        periodEnd: brief.periodEnd!,
      });
      const payload = await d.compose(inputs);
      const composed = (await storage.updateBrief(brief.id, {
        payload: JSON.stringify(payload),
        status: "composed",
        error: null,
      }))!;
      return sendStored(composed, cfg, d);
    } catch (err: any) {
      blog(`compose failed for ${brief.briefDate}: ${err.message}`);
      return (await storage.updateBrief(brief.id, {
        status: "failed_compose",
        error: err.message,
      }))!;
    }
  }

  if (action === "fallback") {
    blog(`attempts exhausted for ${brief.briefDate} — sending fallback headlines`);
    return sendStored({ ...brief, payload: null }, cfg, d);
  }

  // action === "send"
  return sendStored(brief, cfg, d);
}

export async function briefTick(now: Date = new Date(), partialDeps: Partial<PipelineDeps> = {}): Promise<void> {
  const cfg = getBriefConfig();
  if (!cfg.enabled) return;

  const { run, dateStr, reason } = shouldRunNow(now, cfg);
  if (!run) return;

  const existing = await storage.getRealBriefByDate(dateStr);
  const action = nextAction(existing);
  if (action === "done") return;

  blog(`tick: ${dateStr} action=${action} (${reason})`);
  let brief = existing;
  if (!brief) {
    const prev = await storage.getLatestRealBrief();
    const window = computeWindow(now, prev?.periodEnd ?? null);
    brief = await storage.createBrief({
      briefDate: dateStr,
      manual: false,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      status: "pending",
      attempts: 0,
    });
  }
  await executeAction(brief, action, cfg, partialDeps);
}

export async function runManualBrief(partialDeps: Partial<PipelineDeps> = {}): Promise<Brief> {
  const cfg = getBriefConfig();
  if (!cfg.enabled) {
    throw new Error(`Morning brief is not configured: ${cfg.disabledReason}`);
  }
  const d = deps(partialDeps);
  const now = new Date();
  const { dateStr } = zonedParts(now, cfg.timeZone);
  const prev = await storage.getLatestRealBrief();
  const window = computeWindow(now, prev?.periodEnd ?? null);
  const brief = await storage.createBrief({
    briefDate: dateStr,
    manual: true,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    status: "pending",
    attempts: 0,
  });
  const result = await executeAction(brief, "compose", cfg, d);
  if (result.status !== "sent") {
    throw new Error(`Manual brief failed (${result.status}): ${result.error || "unknown error"}`);
  }
  return result;
}

let started = false;

export function startBriefScheduler(): void {
  if (started) return;
  started = true;
  const cfg = getBriefConfig();
  if (!cfg.enabled) {
    blog(`scheduler disabled: ${cfg.disabledReason}`);
    return;
  }
  blog(`scheduler started: weekdays ${cfg.hour}:00 ${cfg.timeZone}, ${cfg.recipients.length} recipient(s), tick every ${TICK_MS / 60000} min`);
  setInterval(() => {
    briefTick().catch(err => console.error("Morning brief tick error (non-fatal):", err));
  }, TICK_MS);
  // Also run one tick shortly after boot so a restart after 7am still sends today's brief
  setTimeout(() => {
    briefTick().catch(err => console.error("Morning brief boot tick error (non-fatal):", err));
  }, 15_000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites (scheduler tests included).

- [ ] **Step 5: Wire into `server/index.ts`**

Add to imports:

```ts
import { startBriefScheduler } from "./morning-brief/scheduler";
```

Immediately after the `ensureBriefsTable().catch(...)` block added in Task 2, add:

```ts
      startBriefScheduler();
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run check
git add server/morning-brief/scheduler.ts server/morning-brief/scheduler.test.ts server/index.ts
git commit -m "feat: add morning brief scheduler with status machine and fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: API routes

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `runManualBrief` from `server/morning-brief/scheduler`, `storage.getBriefs`/`storage.getBrief`.
- Produces HTTP endpoints:
  - `POST /api/brief/send-now` → `200` with the `Brief` row JSON, or `500 { error }` (message from `runManualBrief`)
  - `GET /api/briefs?limit=30` → `Brief[]`
  - `GET /api/briefs/:id` → `Brief` or `404`

- [ ] **Step 1: Add routes**

In `server/routes.ts`, add to the morning-brief import (new line near the other local imports at the top):

```ts
import { runManualBrief } from "./morning-brief/scheduler";
```

Then add these routes near the existing briefings routes (after the `app.get("/api/briefings/latest", ...)` block around line 3605, matching the file's try/catch style):

```ts
  // Morning Brief (push email)
  app.post("/api/brief/send-now", async (_req, res) => {
    try {
      const brief = await runManualBrief();
      res.json(brief);
    } catch (err: any) {
      console.error("Error sending manual brief:", err);
      res.status(500).json({ error: err.message || "Failed to send brief" });
    }
  });

  app.get("/api/briefs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const rows = await storage.getBriefs(Number.isNaN(limit) ? 30 : limit);
      res.json(rows);
    } catch (err) {
      console.error("Error fetching briefs:", err);
      res.status(500).json({ error: "Failed to fetch briefs" });
    }
  });

  app.get("/api/briefs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid brief ID" });
      const row = await storage.getBrief(id);
      if (!row) return res.status(404).json({ error: "Brief not found" });
      res.json(row);
    } catch (err) {
      console.error("Error fetching brief:", err);
      res.status(500).json({ error: "Failed to fetch brief" });
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Manual verification (requires `RESEND_API_KEY` + `BRIEF_RECIPIENTS` in `.env` / local env)**

Start the dev server: `npm run dev`

In a second terminal:

```bash
curl -s http://localhost:5000/api/briefs
```
Expected: `[]` (or prior rows).

If Resend credentials are configured locally, trigger a real test send:

```bash
curl -s -X POST http://localhost:5000/api/brief/send-now
```
Expected: JSON with `"status":"sent"`, `"manual":true`, and a populated `payload` string; the email arrives in the recipient inbox. Without credentials, expected: `{"error":"Morning brief is not configured: RESEND_API_KEY is not set"}` — that exact behavior is correct; note it and continue.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add morning brief API routes (send-now, archive)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Client — Morning Brief page, route, nav item

**Files:**
- Create: `client/src/pages/morning-brief.tsx`
- Modify: `client/src/App.tsx` (lazy route)
- Modify: `client/src/components/app-sidebar.tsx` (nav item)

**Interfaces:**
- Consumes: `GET /api/briefs`, `POST /api/brief/send-now` (Task 8), `Brief` type from `@shared/schema`, `BriefPayload`/`briefPayloadSchema` from `@shared/brief-payload`, existing UI kit (`Card`, `Badge`, `Button`, `Skeleton`, `useToast`, `apiRequest`, `queryClient`).
- Produces: `/morning-brief` page (archive list + payload detail + send-test button).

- [ ] **Step 1: Create the page**

Create `client/src/pages/morning-brief.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Send, TrendingUp, TrendingDown, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import type { Brief } from "@shared/schema";
import { briefPayloadSchema, type BriefPayload } from "@shared/brief-payload";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Sent", variant: "default" },
  sent_fallback: { label: "Fallback sent", variant: "secondary" },
  composed: { label: "Composed", variant: "secondary" },
  pending: { label: "Pending", variant: "outline" },
  failed_compose: { label: "Compose failed", variant: "destructive" },
  failed_send: { label: "Send failed", variant: "destructive" },
};

function parsePayload(brief: Brief): BriefPayload | null {
  if (!brief.payload) return null;
  try {
    return briefPayloadSchema.parse(JSON.parse(brief.payload));
  } catch {
    return null;
  }
}

function PayloadView({ payload }: { payload: BriefPayload }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary">{payload.headline}</h2>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top stories</h3>
        <div className="space-y-4">
          {payload.topStories.map((s, i) => (
            <div key={i} className="border-b border-border pb-3 last:border-0">
              <a
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline inline-flex items-center gap-1"
                data-testid={`link-story-${i}`}
              >
                {s.title}
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
              <span className="text-xs text-muted-foreground ml-2">{s.sourceName}</span>
              <p className="text-sm mt-1">{s.whyItMatters}</p>
              {s.dbAngle && (
                <div className="mt-2 rounded-md bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                    Demandbase angle{s.dbAngle.strength === "moderate" ? " (moderate)" : ""}
                  </span>
                  <p className="text-sm mt-0.5">{s.dbAngle.text}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {payload.competitorWatch.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Competitor watch</h3>
          <div className="space-y-2">
            {payload.competitorWatch.map((c, i) => (
              <p key={i} className="text-sm">
                <span className="font-semibold">{c.competitor}</span> — {c.summary}
              </p>
            ))}
          </div>
        </section>
      )}

      {payload.trendPulse.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Trend pulse</h3>
          <div className="space-y-1.5">
            {payload.trendPulse.map((t, i) => (
              <p key={i} className="text-sm flex items-center gap-1.5">
                {t.direction === "rising" ? (
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                )}
                <span className="font-medium">{t.trend}</span>
                <span className="text-muted-foreground">— {t.note}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      {payload.radar.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Radar</h3>
          <ul className="space-y-1">
            {payload.radar.map((r, i) => (
              <li key={i} className="text-sm">
                <a href={r.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {r.title}
                </a>
                <span className="text-xs text-muted-foreground ml-1.5">{r.sourceName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function MorningBrief() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: briefs, isLoading } = useQuery<Brief[]>({ queryKey: ["/api/briefs"] });

  const sendNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brief/send-now");
      return res.json();
    },
    onSuccess: (brief: Brief) => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefs"] });
      setSelectedId(brief.id);
      toast({ title: "Test brief sent", description: "Check your inbox." });
    },
    onError: (err: Error) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const selected = briefs?.find(b => b.id === selectedId) ?? briefs?.[0];
  const payload = selected ? parsePayload(selected) : null;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="h-6 w-6" /> Morning Brief
            </h1>
            <p className="text-sm text-muted-foreground">
              Weekday email digest — archive of every send.
            </p>
          </div>
          <Button onClick={() => sendNow.mutate()} disabled={sendNow.isPending} data-testid="button-send-test">
            <Send className="h-4 w-4 mr-2" />
            {sendNow.isPending ? "Composing & sending…" : "Send test brief now"}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !briefs || briefs.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <p className="font-medium">No briefs yet.</p>
            <p className="text-sm mt-1">
              The first one sends on the next weekday morning — or click "Send test brief now" to try it immediately.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
            <div className="space-y-2">
              {briefs.map(b => {
                const status = STATUS_LABEL[b.status] ?? { label: b.status, variant: "outline" as const };
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selected?.id === b.id ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                    }`}
                    data-testid={`button-brief-${b.id}`}
                  >
                    <div className="text-sm font-medium">
                      {format(parseISO(b.briefDate), "EEE MMM d, yyyy")}
                      {b.manual && <span className="text-xs text-muted-foreground ml-1">(test)</span>}
                    </div>
                    <Badge variant={status.variant} className="mt-1">{status.label}</Badge>
                  </button>
                );
              })}
            </div>
            <Card className="p-5">
              {selected && payload ? (
                <PayloadView payload={payload} />
              ) : selected ? (
                <div className="text-sm text-muted-foreground flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
                  <div>
                    <p className="font-medium text-foreground">No composed content for this brief.</p>
                    <p className="mt-1">Status: {selected.status}{selected.error ? ` — ${selected.error}` : ""}</p>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `client/src/App.tsx`, add with the other lazy imports:

```ts
const MorningBrief = lazy(() => import("@/pages/morning-brief"));
```

And in the `<Switch>`, after the `/briefing` route:

```tsx
        <Route path="/morning-brief" component={MorningBrief} />
```

- [ ] **Step 3: Add the nav item**

In `client/src/components/app-sidebar.tsx`, add `Mail` to the existing lucide-react import, and in `navItems` insert after the "Daily Briefing" entry:

```ts
  { title: "Morning Brief", url: "/morning-brief", icon: Mail },
```

- [ ] **Step 4: Typecheck and verify in the browser**

```bash
npm run check
```
Expected: no errors.

Run `npm run dev`, open `http://localhost:5000/morning-brief`.
Expected: page renders with the empty state (or archive rows if Task 8's manual send ran); sidebar shows "Morning Brief"; clicking "Send test brief now" without Resend config shows the destructive toast with the explicit config error — that is correct behavior.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/morning-brief.tsx client/src/App.tsx client/src/components/app-sidebar.tsx
git commit -m "feat: add Morning Brief archive page with send-test button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, Railway env, deploy smoke test

**Files:**
- Modify: `replit.md` (add feature bullet under Core Features)
- Railway environment (via CLI, guided)

**Interfaces:**
- Consumes: everything shipped in Tasks 1-9.
- Produces: documented feature; production env configured; verified production send.

- [ ] **Step 1: Document the feature**

In `replit.md`, under `**Core Features & Technical Implementations:**`, add after the News Aggregation bullet:

```markdown
- **Morning Brief (Push Email):** Weekday-morning email digest (default 7:00 America/Chicago, config via `BRIEF_HOUR`/`BRIEF_TZ`/`BRIEF_RECIPIENTS`) composed by Claude from the last 24h of articles (72h cap covers weekends), trend snapshot deltas, and competitor mentions. Structured `BriefPayload` (shared zod schema) renders to branded HTML email via Resend and to the in-app `/morning-brief` archive page. In-process 5-min scheduler with a `briefs` table ledger (partial unique index; `manual` test sends never block the daily send), 3 compose attempts, then a fallback headlines email — a weekday morning never passes silently. Module: `server/morning-brief/`.
```

- [ ] **Step 2: Configure Railway env vars (requires the user's Resend API key)**

Confirm the linked service first (`railway status`). Then, with the key provided by the user (never commit it):

```bash
railway variables --set "RESEND_API_KEY=<key from user>" --set "BRIEF_RECIPIENTS=<user's email>" --set "BRIEF_TZ=America/Chicago" --set "BRIEF_HOUR=7" --set "APP_URL=<the app's public Railway URL>"
```

Verify: `railway variables --kv | grep BRIEF` shows the three BRIEF vars.

**STOP if the user hasn't provided a Resend API key** — they create one at resend.com (free tier). This is a blocking user input.

- [ ] **Step 3: Deploy and smoke test**

Deploy per the repo's normal flow (`git push` if Railway auto-deploys from main, else `railway up`). Then:

```bash
railway logs | grep morning-brief
```
Expected: `[morning-brief] briefs table ready` and `[morning-brief] scheduler started: weekdays 7:00 America/Chicago, 1 recipient(s), tick every 5 min`.

Production smoke test:

```bash
curl -s -X POST https://<railway-app-url>/api/brief/send-now
```
Expected: JSON with `"status":"sent"`; the email arrives in the inbox; `/morning-brief` in the production app shows the test row.

- [ ] **Step 4: Run the full verification suite and commit**

```bash
npm test
npm run check
git add replit.md
git commit -m "docs: document Morning Brief push email feature

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Confirm the real send next weekday morning**

Non-blocking follow-up for the user: the first scheduled (non-manual) brief should arrive at ~7:00 AM Central the next weekday. If it doesn't, `railway logs | grep morning-brief` shows the tick decisions and any compose/send errors, and the `/morning-brief` archive page shows the row's status and stored error.
