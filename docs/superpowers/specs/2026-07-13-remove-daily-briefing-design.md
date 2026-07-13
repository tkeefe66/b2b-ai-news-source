# Remove Daily Briefing — Design

**Date:** 2026-07-13
**Status:** Approved by Tom (conversation)
**Context:** The Briefings hub houses Morning Brief, Daily Briefing, and Deep Reports. Morning Brief (scheduled email digest, own `briefs` table and `server/morning-brief/` module) supersedes Daily Briefing (on-demand executive summaries). Tom chose FULL removal — including the bundled Compare and Time Machine sub-features, backend endpoints, storage methods, and the `briefings` table.

## Decisions

- Remove everything: UI tab, the 887-line `briefing.tsx` page (Briefings + Compare + Time Machine sub-tabs), all six `/api/briefings/*` endpoints, five storage methods, `briefings` schema objects.
- Historic `briefings` rows are discarded (derived artifacts; nothing will read them). Table drops at next `db:push` — that drop is EXPECTED and should be confirmed at the prompt (unlike the runtime-managed objects incident).
- Legacy `/briefing` route redirect repoints to `/briefings` (Morning Brief default tab).
- AI Analyst chat loses its stale daily-briefing context injection (dead weight once the table is gone).
- Morning Brief (`/api/brief*`, `briefs` table) and Deep Reports (trends tables) are untouched — verified disjoint by exploration.

## Removal seams (exact, from exploration of 83b6c76+)

1. **client/src/pages/briefings.tsx**: remove `"on-demand"` from `VALID_TABS` (~line 8), the TabsTrigger block (~39-42), TabsContent block (~53-55), `import Briefing from "@/pages/briefing"` (line 5). Default tab remains `morning-brief`.
2. **client/src/pages/briefing.tsx**: delete the file (887 lines).
3. **client/src/App.tsx**: `/briefing` redirect (~46-48) target changes from `/briefings?tab=on-demand` to `/briefings`.
4. **client/src/components/app-sidebar.tsx** (~line 35): description drops "on-demand summaries" (e.g. "Morning email digest and deep AI reports").
5. **client/src/components/command-palette.tsx** (~line 33): remove "daily briefing" from the `/briefings` search-alias string.
6. **client/src/components/how-trends-works.tsx**: grep for Daily Briefing copy; update if present.
7. **server/routes.ts**: remove `GET /api/briefings` (~3705-3713), `DELETE /api/briefings/:id` (~3715-3726), `GET /api/briefings/latest` (~3728-3736), `POST /api/briefings/generate` (~3773-3892), `POST /api/briefings/compare` (+ its zod schema, ~3894+), `POST /api/briefings/time-machine` (+ its zod schema, ~3980+).
8. **server/routes.ts** `POST /api/chat` (~2794): remove `storage.getLatestBriefing()` from the `Promise.all` (~2808), the `latestBriefing`/`briefingContext` block (~2860-2866), and the "DAILY BRIEFINGS" system-prompt references (~2931, 2937, 2947, 2953). The chat must keep working with the remaining context sources.
9. **server/storage.ts**: remove the five interface methods (~128-132) and implementations (~698-719); remove `briefings`, `Briefing`, `InsertBriefing` from the schema imports.
10. **shared/schema.ts**: remove `briefings` table (~159-167), `insertBriefingSchema` (~180-183), `Briefing`/`InsertBriefing` types (~216-217).

## Verification

- `npm run check` 0 errors; `npm run test` 112/112; `npm run build` succeeds.
- `grep -ri "briefings\b" server client shared` → zero hits outside Morning Brief's distinct `/briefings` HUB route path in client nav (the hub page/route keeps its name) — reviewer confirms no dangling references to the removed feature.
- Deploy: `db:push` will propose dropping the `briefings` table — CONFIRM it. Then push → auto-deploy → smoke: hub loads with two tabs, `/briefing` redirects, AI Analyst chat answers, `/api/briefings` returns 404.

## Out of scope

- Renaming the hub or its `/briefings` route (keeps its name; it still houses Morning Brief + Deep Reports).
- Any Morning Brief or Deep Reports change.
