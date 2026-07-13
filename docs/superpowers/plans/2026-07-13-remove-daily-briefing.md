# Remove Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove the Daily Briefing feature (UI tab, page, endpoints, storage, schema) while leaving Morning Brief and Deep Reports untouched.

**Architecture:** Pure deletion across four seams — hub tab, client page + nav traces, server routes + AI-chat context cleanup, storage + schema. The `briefings` table drop happens at deploy-time db:push (expected, confirm it).

**Tech Stack:** Existing stack; no new code beyond copy tweaks and redirect target.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-remove-daily-briefing-design.md` — its "Removal seams" section IS the task list; line numbers are anchors from a fresh scan, locate by content if drifted.
- Morning Brief (`/api/brief*` routes, `briefs` table, `server/morning-brief/`) and Deep Reports (`deep-reports.tsx`, trends endpoints/tables) must be byte-identical after this change.
- The hub page keeps its name and `/briefings` route; only the on-demand tab disappears. Default tab stays `morning-brief`.
- The AI Analyst chat (`POST /api/chat`) must still compile and function with the briefing context removed — remove the Promise.all entry cleanly (mind the array destructuring positions).
- No db:push locally. tsc 0, 112/112 tests, build success.

---

### Task 1: The removal

**Files:**
- Modify: `client/src/pages/briefings.tsx`, `client/src/App.tsx`, `client/src/components/app-sidebar.tsx`, `client/src/components/command-palette.tsx`, possibly `client/src/components/how-trends-works.tsx`
- Delete: `client/src/pages/briefing.tsx`
- Modify: `server/routes.ts`, `server/storage.ts`, `shared/schema.ts`

- [ ] **Step 1:** Apply spec seams 1-6 (client), including deleting `briefing.tsx`
- [ ] **Step 2:** Apply spec seams 7-8 (routes + chat cleanup). For the chat's `Promise.all`, remove the `storage.getLatestBriefing()` element AND its corresponding destructured variable in the same position; then remove every use of `latestBriefing`/`briefingContext` and the four "DAILY BRIEFINGS" prompt strings.
- [ ] **Step 3:** Apply spec seams 9-10 (storage methods + schema objects)
- [ ] **Step 4:** Run `npm run check` (0 errors), `npm run test` (112/112), `npm run build` (success)
- [ ] **Step 5:** Grep audit: `grep -rn "getLatestBriefing\|createBriefing\|deleteBriefing\|insertBriefingSchema\|InsertBriefing\|api/briefings" client server shared` → zero hits; `grep -rn "Daily Briefing\|daily briefing" client server shared` → zero hits
- [ ] **Step 6:** Commit: `feat: remove Daily Briefing — Morning Brief supersedes it`

### Task 2: Verification (controller)

- [ ] Review diff (task reviewer), confirm Morning Brief/Deep Reports untouched
- [ ] Deploy: db:push (CONFIRM the briefings-table drop), push, smoke (hub two tabs, /briefing redirect, chat works, /api/briefings 404)
