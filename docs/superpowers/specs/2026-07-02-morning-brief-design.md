# Morning Brief — Push Delivery Design Spec

**Date:** 2026-07-02
**Status:** Implemented — in production since 2026-07-08 (see §12 Implementation Addendum)
**Author:** Tom Keefe + Claude

---

## 1. Problem & Intent

The app aggregates and analyzes B2B/MarTech intelligence well, but it is a pull experience: nothing reaches the user unless they remember to open it — and they don't. The GTM Intel Engine v2 spec (2026-04-20) solved this with a push-first rebuild in a new repo, but that rebuild never started; its scope was the blocker.

This design retrofits the push experience into the existing v1 app: a **Morning Brief** — one email each weekday morning that makes the reader fully current in three minutes. The email is the briefing; the app is the depth layer (content creation, trend exploration, archives).

### Decisions made during brainstorm

| Question | Decision |
|---|---|
| Build location | Existing v1 app (this repo), not the v2 rebuild |
| Audience | Tom now; content shaped for the evangelist team, recipients are config |
| Channel | Email now; Slack later once the app passes Demandbase security review |
| Job of the push | Fully briefed in-channel — no teaser mechanics, no withheld info |
| Cadence | Weekday mornings (~7:00), no real-time alert layer in this phase |
| Quiet days | Always send — a short "quiet day" brief beats an unreliable arrival |
| Scheduler | In-process 5-minute tick with a DB ledger, no new Railway service |

### Success criteria

- The brief arrives every weekday morning without exception (fallback content on pipeline failure — a morning never passes silently).
- Reading it end-to-end takes ≤3 minutes (~500 words).
- The subject line alone communicates the day's headline.
- Adding a teammate is a config change. Adding Slack is a renderer, not a rebuild.

---

## 2. Architecture

New module in the existing Express app. No new services.

```
server/morning-brief/
  composer.ts      Gather inputs → one Claude call → BriefPayload (zod-validated)
  render-email.ts  BriefPayload → branded HTML + plain-text alternative
  deliver.ts       Resend send + briefs row update
  scheduler.ts     Weekday-morning due-check tick + status machine
```

Plus:
- `briefs` table (Drizzle) — payload storage, delivery ledger, idempotency
- Routes: `POST /api/brief/send-now` (manual trigger/testing), `GET /api/briefs`, `GET /api/briefs/:id`
- Client: one "Morning Brief" page — archive list + web-rendered payload view + "Send test brief now" button

### Renderer seam (the Slack-readiness move)

The composer produces a structured **BriefPayload**, not prose. Renderers consume it:
- `render-email.ts` — now
- `render-slack.ts` (Block Kit) — future, post security approval
- The in-app archive page — same payload, web styling

Channel migration is additive. The payload schema is the contract.

---

## 3. Data Model

```
briefs
  id            serial PK
  brief_date    date               -- partial unique index WHERE manual = false:
                                   --   one real brief per day; test sends unlimited
  manual        boolean def false  -- true for send-now test runs
  period_start  timestamptz        -- article window covered
  period_end    timestamptz
  payload       jsonb              -- BriefPayload (null until composed)
  status        text               -- pending | composed | sent | sent_fallback
                                   --   | failed_compose | failed_send
  attempts      integer default 0  -- compose attempts
  error         text               -- last error message, nullable
  sent_at       timestamptz        -- nullable
  created_at    timestamptz default now()
```

### BriefPayload (zod schema, stored as jsonb)

```ts
{
  date: string,                    // "2026-07-02"
  headline: string,                // one line; becomes the subject suffix
  periodStart: string, periodEnd: string,
  topStories: Array<{              // 3-5 items
    title: string,
    whyItMatters: string,          // 1-2 sentences
    dbAngle?: { strength: "strong" | "moderate", text: string },
    sourceName: string,
    link: string,                  // original article URL
    articleId: number,
  }>,
  competitorWatch: Array<{         // 0-N; section omitted when empty
    competitor: string,
    summary: string,
    links: Array<{ title: string, url: string }>,
  }>,
  trendPulse: Array<{              // 0-N movers from snapshot delta; omitted when empty
    trend: string,
    direction: "rising" | "cooling",
    note: string,
  }>,
  radar: Array<{                   // 5-8 one-liners
    title: string, sourceName: string, link: string,
  }>,
  contentIdea?: {                  // at most one
    title: string,
    description: string,
    deepLink: string,              // into Thought Leadership with context params
  },
  quietDay: boolean,               // <3 substantive stories; renderer shortens framing
}
```

The **Demandbase angle honesty rule** carries over from the v2 spec: an angle appears only when genuine. The composer prompt instructs Claude to omit `dbAngle` rather than manufacture relevance; most stories should have none.

---

## 4. Composer

Runs once per weekday. Inputs:

1. **Articles** since the previous brief's `period_end`, capped at 72h (Monday covers the weekend), excluding dismissed articles.
2. **Trend snapshots** — latest plus previous, so the prompt can state deltas ("what moved"), not restate the snapshot.
3. **Competitor names** from the Sources competitor database, pre-matched against the article window in SQL/code (cheap string match) so the prompt receives candidates, not the whole corpus.
4. **Demandbase context** — existing `demandbase-context.ts` positioning content.

One Claude call using the same Claude Sonnet model/config the app already uses via `ai-models.ts` (upgrading the model id is orthogonal to this design). Structured-output prompt with per-section word budgets totaling ~500 words. Output parsed with zod. **One compose attempt = the initial call plus at most one repair pass** (the invalid JSON and zod errors go back to the model); an attempt that still fails increments `attempts` and sets `failed_compose`.

Token/cost note: one call per weekday on a bounded input (article titles + descriptions, not full text) — negligible relative to existing AI usage.

---

## 5. Scheduler & Status Machine

In-process `setInterval` tick every 5 minutes (same pattern as the existing RSS refresh loops in `server/index.ts`).

Tick logic, in `BRIEF_TZ`:

```
if today is Sat/Sun → do nothing
if now < BRIEF_HOUR → do nothing
row = briefs[today]
  none              → create pending → compose → send
  failed_compose    → if attempts < 3 → recompose
                      else → send fallback email (top 10 raw headlines
                             by category from DB), status = sent_fallback
  failed_send       → retry send only (never recompose — no duplicate AI spend)
  composed          → send (covers crash between compose and send)
  sent | sent_fallback → done for today
```

The due-check reads only `manual = false` rows, and the partial unique index on `brief_date WHERE manual = false` makes the ledger restart-safe and redeploy-safe: the row, not process memory, is the source of truth. `POST /api/brief/send-now` runs the same pipeline but writes `manual = true` rows — testable any time, any number of times, without ever suppressing or colliding with the real 7am send.

Config (env): `BRIEF_HOUR=7`, `BRIEF_TZ=America/Chicago`, `BRIEF_RECIPIENTS` (comma-separated), `RESEND_API_KEY`, `APP_URL`.

---

## 6. Email Design

**Subject:** `GTM Brief · Wed Jul 2 — {headline}` — briefed from the inbox list view.

**Body:** single column, 600px max, table-based layout, system font stack, plain-text alternative part. Demandbase brand: Midnight `#0D1846` masthead, orange `#F26B43` reserved for DB-angle callouts and the single primary footer action ("Open dashboard →") — accent as signal, not decoration. Article titles link to original sources; depth actions deep-link into the app.

**Section order:** greeting + date → Top Stories (title, why-it-matters, optional angle callout) → Competitor Watch → Trend Pulse → Radar (one-liners) → Content idea ("Create →") → footer. Empty sections are omitted entirely. On `quietDay`, the greeting says so plainly ("Quiet day — 2 stories worth your time") and the email is short.

**Pilot simplifications (deliberate):** sender is Resend's shared `onboarding@resend.dev` until a domain is verified (required before team rollout); no open-tracking pixel; no unsubscribe flow (internal config-list recipients). All three revisit at team rollout.

---

## 7. In-App Surface

One new nav page, **Morning Brief**:
- Archive list (date, headline, status)
- Detail view rendering the stored payload web-style — the email's twin, and later the "view in browser" target for Slack
- "Send test brief now" button → `POST /api/brief/send-now`

Nothing else. No preferences UI, no per-user settings in this phase.

---

## 8. Error Handling & Observability

- **Never a silent weekday.** Compose failure after 3 attempts → fallback email of the morning's top 10 headlines straight from the DB. Degraded beats absent.
- Resend sends wrapped in `p-retry` (existing dependency) with backoff; Anthropic 429/5xx likewise.
- Every state transition, Claude call (duration, token usage), and send result logged via the existing `log()` pattern — a bad morning is diagnosable from Railway logs alone.
- `error` column stores the last failure for the archive page to surface.

---

## 9. Testing

Introduces **vitest** (repo currently has no test framework).

Unit targets (pure logic, high value):
- Window calculation — 24h normal case, 72h Monday case, first-run case (no prior brief)
- Due-check — timezone handling, weekend skip, already-sent, pre-7am, test-send non-suppression
- BriefPayload zod schema — valid/invalid fixtures, repair-pass trigger
- Renderer — empty-section omission, quiet-day framing, HTML snapshot test
- Status machine transitions — including crash-between-compose-and-send recovery

Integration: `send-now` route with Anthropic + Resend mocked at the client seam.

Prompt quality is not unit-testable: the loop is "Send test brief now" against real data, iterating on the composer prompt until the email consistently earns its three minutes.

---

## 10. Explicitly Out of Scope (this phase)

Deferred to the team/Slack era, with seams already in place:

- Slack Block Kit renderer (payload contract is the seam)
- Per-user subscriptions/preferences, unsubscribe flows (recipients env is the seam)
- Real-time alert triggers (v2 spec §4 remains the reference)
- Open tracking, digest analytics
- Domain-verified sender
- Any changes to the v2 rebuild question — this pilot generates the evidence for whether v2 is still needed

---

## 11. Relationship to the v2 Spec

This is not a competing vision. It implements the v2 spec's core principle — "the system delivers intelligence to users; email is the daily entry point" — inside v1 at ~15% of the surface area. The BriefPayload sections mirror the v2 digest email structure (§6 of that spec). If v2 proceeds later, the composer prompt, payload schema, renderers, and everything learned about what makes the email worth reading transfer directly.

---

## 12. Implementation Addendum (as built, 2026-07-02 → 2026-07-08)

Shipped via 10 reviewed tasks + a final whole-branch review; 62 automated tests. First production send: 2026-07-08 (brief #1, delivered via Resend). Deltas from the design above, in the order they were discovered:

**Hardening from the final whole-branch review (commit `f3d93c9`):**
- **URL scheme enforcement.** zod's `.url()` accepts `javascript:` URLs. All model-generated link fields now use an `httpUrl` refinement (http/https only) and `contentIdea.deepLink` must match `^\/` (app-relative). Blocks a prompt-injection→stored-XSS chain into both the email and archive-page `href` sinks.
- **Deterministic render-failure escape.** §5's ladder had a gap: a pre-send parse/render error landed in `failed_send` and retried the same doomed render forever, with fallback unreachable. As built, `sendStored` renders in its own try; pre-send failures clear the payload and set `failed_compose`, re-entering the compose→fallback ladder. The rendered date also comes from `brief.brief_date` (server truth), never the model-echoed `payload.date`.
- **Tick re-entrancy guard.** `briefTick` has a per-process in-flight flag (a compose slower than the 5-min tick can no longer double-compose/double-send). Consequence: **single-replica assumption** — documented in replit.md; multi-replica requires moving the send claim into SQL.
- **`BRIEF_HOUR` validation.** Non-finite or out-of-range values fall back to 7 with a logged warning (a NaN hour previously meant silent send-at-midnight).
- **Boot ordering.** `startBriefScheduler()` is chained after `ensureBriefsTable()` settles.

**Production shakedown fixes (first live day, 2026-07-08):**
- **Composer output cap 4096 → 8192 tokens** (`5e4449e`). Real payloads (URL-heavy JSON) truncated mid-array at 4096; both compose attempts died at the same byte offset. Repair passes cannot fix truncation.
- **`p-retry` must be bundled** (`c2e583b`). It is ESM-only; the production server is an esbuild CJS bundle with external deps, and the external `require()` failed at runtime (`(0, X.default) is not a function`) while dev/tests passed. Fixed via the bundle allowlist in `script/build.ts`. This constraint applies to any future ESM-only dependency.

**Scope addition (`b592d33`):**
- §7 said the in-app surface was list + detail + send-now and "nothing else." As built, the `/morning-brief` page also has a collapsible **"How it works"** explainer (schedule, content sources, status meanings, testing/config) that auto-expands when the archive is empty, serving as onboarding for future team members.

**Known follow-ups (non-blocking, from the final review):**
- `failed_send` retries every 5 minutes until midnight with no backoff cap; p-retry also retries permanent 4xx errors.
- Fallback email is top-10 by recency, not grouped by category as §5 states.
- Anthropic calls rely on the SDK's built-in retries plus the attempt ladder rather than an explicit p-retry wrapper (§8 wording).
- Archive page omits `contentIdea` and quiet-day framing (not a pixel-perfect email twin).
- A pre-send failure on the fallback-fetch path is labeled `failed_compose` with a "render failed" message (label imprecision only).
