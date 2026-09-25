# Verification — KYC review prototype (Prompt 4 handoff)

Date: 2026-09-25 (UTC). Revision under test: `main` at `42afe32` plus the
Prompt 4 commits (see `git log`). Environment: Ubuntu, Node v24.19.0 (nvm),
npm 10.8.3. No secret values appear in this document.

Two databases were used and kept separate throughout:

- **Demonstration DB** — `/home/ubuntu/repos/cog-demo/prisma/dev.db`
  (`DATABASE_URL=file:./dev.db`). Created on this machine by `npm run db:migrate`
  + `npm run db:seed` at the start of Prompt 4 (the Prompt 3 walkthrough ran on a
  different machine; its database file was not available here). Never reset.
- **Clean-checkout DB** — `/home/ubuntu/clean-cog-demo/prisma/clean-verify.db`, in a
  fresh `git clone` of the local repository, port 3100.
- `npm test` additionally creates its own temporary SQLite file per run
  (`tests/setup.ts`); the demo DB counts were unchanged after the suite
  (3 users / 20 cases / 6 seed events + the 1 decision recorded below).

## 1. Critical-path review (code reading, one decision end to end)

Browser `DecisionForm.submit()` → `POST /api/kyc-cases/:id/decisions`
(`credentials: same-origin`, JSON `{ action, reason, expectedVersion }`) →

| Step | Where | Finding |
| --- | --- | --- |
| Session validation | `requireReviewer(request.headers)` → `getCurrentUser` → `auth.api.getSession` + re-read of `role`/`active` from `User` | Anonymous → `401`; inactive user → sessions deleted, `401`. |
| Server-side role check | `requireReviewer` (`role !== "REVIEWER"` → `AuthError 403`); `decideCase` re-asserts the actor role | Runs **before** body parsing and before the same-origin check. |
| Request validation | `decisionInputSchema` (zod, `.strict()`): `action` enum, `reason` trimmed 10–500, `expectedVersion` non-negative int; `CASE_ID_PATTERN` on the path | Extra fields such as `actorId`/`role`/`status` → `400`; actor id always comes from the session. |
| Conditional case update | `tx.kycCase.updateMany({ where: { id, status: "PENDING", version: expectedVersion }, data: { status, version: { increment: 1 } } })` | `count !== 1` → transaction aborted → `409 VERSION_CONFLICT` / `409 CASE_NOT_PENDING` / `404`. |
| Audit insertion | `tx.auditEvent.create(...)` inside the **same** `$transaction`, then the detail row is re-read inside the transaction and the new event must be present | Unique `(caseId, newVersion)` provides a second guard. |
| Transaction commit | Interactive `$transaction` with timeout; any throw after the update rolls back both writes; transient SQLite busy errors retried ≤ 3× with the original `expectedVersion` | Verified by tests 9/9b/10 below. |
| Browser success state | Only when the `200` body contains `case` **and** `event`; the server's case replaces local state, controls disappear, new event highlighted | `409` → fixed message + Reload (no auto-retry); `401/403/404/503` mapped explicitly. |

Gap checklist:

| Potential gap | Result |
| --- | --- |
| Direct API route bypassing authorization | None. All three `/api/kyc-cases*` handlers call `requireUser`/`requireReviewer` first; `/api/auth/*` is the library handler. |
| Server-rendered page reading data without authentication | None. `(shell)/layout.tsx` redirects anonymous users **and** `/kyc`, `/kyc/[id]` each call `requireUserOrRedirect` before any query. `/app` only redirects to `/kyc`. |
| Client-supplied role or actor trusted | None. Actor = session user re-read from DB; strict schema rejects extra fields (test 3, curl below). |
| Unconditional update allowing stale writes | None. Update predicate includes `status = PENDING` and exact `version`. |
| Audit insertion after the case transaction | None. Same interactive transaction; event existence re-checked before returning. |
| Shared cache exposing authenticated case data | None. All API responses `Cache-Control: no-store, private` + `Vary: Cookie` (observed on the decision response); pages and routes are `force-dynamic`; no `unstable_cache`/`revalidate`/fetch caching in `src/`. |
| Normal startup resetting the seed data | None. `next dev`/`next start` import nothing from `prisma/seed.ts` or `prisma/reset.ts`; restart log contains no seed output; counts unchanged after restart. |

No critical-path defects were found. Small corrections made in Prompt 4 (not
security changes): removed the `lint` script (`next lint` is deprecated and
blocked on an interactive ESLint prompt), added `engines.node >= 20.6` and
`.nvmrc`, and made `db:reset:destructive` print its target and refuse non-`file:`
URLs.

## 2. Commands run and results

| # | Command (where) | Result |
| --- | --- | --- |
| 1 | `npm ci` (demo checkout) | 143 packages, 0 peer conflicts, 7 audit advisories (3 moderate, 4 high; all dev-transitive) |
| 2 | `npm run db:migrate` + `npm run db:seed` (demo) | migrations applied; `usersCreated 3, casesCreated 20, eventsCreated 6` |
| 3 | `npm run typecheck` | exit 0 |
| 4 | `npm test` (demo checkout) | **3 files / 23 tests passed** (`kyc-api` 17, `decision-service` 5, `inactive-session` 1), 12.3 s |
| 5 | `npm run build` | exit 0; all app routes dynamic (ƒ), `/_not-found` static |
| 6 | `npm run start` (production server, :3000) | `/sign-in` 200; anonymous `/kyc` 307 → `/sign-in`; anonymous `GET /api/kyc-cases` and `/api/kyc-cases/KYC-1007` → 401 |
| 7 | Persistence probe (curl against 6, see §3) | pass |
| 8 | `git clone` → `npm ci` (clean checkout `2ee4a86`) | 143 packages in 8 s, same advisories, `engines` accepted |
| 9 | `cp .env.example .env` unedited → `npm run db:migrate` → `npm run db:seed` (clean) | migrate ok; seed **exit 1**: `SEED_PASSWORD_ALEX still holds the placeholder from .env.example; set a real local value.` (intended guard) |
| 10 | `.env` with real values → `npm run db:migrate` → `npm run db:seed` (clean, `file:./clean-verify.db`) | seed `3 / 20 / 6`; second `db:seed` → `usersUpdated 3, casesSkipped 20` (idempotent) |
| 11 | `next dev -p 3100` (clean) | `/sign-in` 200; anonymous `/kyc` 307; Alex and Taylor sign-in 200 with documented emails and `.env` passwords; Alex `/kyc` 200; `/kyc/KYC-1007` renders Morgan Ellis + "Review decision…" for Alex, "Read-only" for Taylor |
| 12 | `npm test` (clean) | 3 files / 23 tests passed; `clean-verify.db` still 20 cases / 6 events afterwards |
| 13 | `npm run lint` | **not run** — script removed in Prompt 4 (was `next lint`, deprecated, hung on an interactive prompt; no ESLint configured) |

Prompt 3 browser verification (Chrome, testing agent) at the same UI code
(`1a43d44`; `42afe32` and the Prompt 4 commits touch only docs, `package.json`
scripts/engines and `prisma/reset.ts`) is recorded in `docs/build-log.md` § Prompt 3:
queue/filter/search states, KYC-1007 evidence, approve + escalate with
persisted history, stale-version `409` in a second tab, Taylor read-only view,
sign-out, not-found, keyboard confirmation. It was **not** re-run in Prompt 4.

## 3. Persistence test (demonstration DB, production server)

1. `npm run start` on :3000 against `prisma/dev.db`. Signed in as
   `alex@demo.test` via `POST /api/auth/sign-in/email` (Origin = `BETTER_AUTH_URL`).
2. Before: `GET /api/kyc-cases/KYC-1012` → `PENDING`, version 0, 0 history events.
3. Decision: `POST /api/kyc-cases/KYC-1012/decisions`
   `{"action":"REJECT","reason":"Prompt 4 persistence check: name mismatch not resolved by supporting documents.","expectedVersion":0}`
   → **200**, headers `cache-control: no-store, private`, `vary: Cookie`.
   Recorded: **case `KYC-1012`, status `REJECTED`, version `1`, audit event
   `cmuga44fl0001qhi3xiz8wrf7`** (previousVersion 0 → newVersion 1, actor Alex Reviewer).
4. Immediate stale replay with `expectedVersion: 0` → `409 CASE_NOT_PENDING`
   (`currentStatus REJECTED, currentVersion 1`), no new event.
5. Stopped the server (`SIGTERM` to `next-server`; confirmed `curl :3000` →
   connection refused; no `next` process left).
6. Restarted `npm run start` with the same `.env`/`DATABASE_URL`; no
   migrate/seed/reset run; start log contains no seed output.
7. After restart, `GET /api/kyc-cases/KYC-1012` → `REJECTED`, version `1`,
   history `[ cmuga44fl0001qhi3xiz8wrf7 : REJECTED, 0 → 1, Alex Reviewer, same reason ]`.
   Pending count 14 → 13.
8. Direct SQLite read through a throw-away Prisma script (bypassing the app):
   `KYC-1012 REJECTED v1`; `auditEvent where caseId = KYC-1012` → exactly one
   row `cmuga44fl0001qhi3xiz8wrf7`; totals 3 users / 20 cases / 7 events / 13 pending.

Result: **pass**. The demonstration DB now differs from the seed by this one
decision (KYC-1012 rejected). It was not reset.

## 4. Authorization probes against the running production server

| Request | Response |
| --- | --- |
| Anonymous `GET /api/kyc-cases`, `GET /api/kyc-cases/KYC-1007` | `401 UNAUTHENTICATED` |
| Anonymous `GET /kyc` | `307 → /sign-in` |
| Taylor (VIEWER) `POST …/KYC-1003/decisions` and `…/KYC-1012/decisions` | `403 FORBIDDEN "Reviewer permission required."` — DB unchanged |
| Alex (REVIEWER) body with extra `actorId`/`role` fields | `400 INVALID_DECISION` |
| Alex decision on already-`ESCALATED` `KYC-1003` (`expectedVersion 0`) | `409 CASE_NOT_PENDING` |

## 5. Acceptance matrix

| Behaviour | Status | Evidence |
| --- | --- | --- |
| Anonymous users cannot read case data | **Verified** | curl §2 #6 (401 on both API routes, 307 on pages); tests 1, 1b, "rejects a session that has been signed out" |
| Viewers cannot mutate through direct requests | **Verified** | curl §4 (403, no write); test 2b "viewer's direct decision request returns 403 and writes nothing"; test 3 (client-supplied identity/role) |
| Successful decisions have exactly one matching audit event | **Verified** | §3 step 8 (one `auditEvent` row for KYC-1012, `newVersion = case.version`); test 4 |
| Audit insertion failure rolls back the state change | **Verified (tests)** | test 9 "rolls back the case update when audit insertion fails", test 9b unique-constraint rollback — both passed in the demo and clean checkouts. Not reproduced against the live server (would require fault injection). |
| Stale and competing decisions cannot overwrite the accepted result | **Verified** | §3 step 4 (409 after restart-safe decision); tests 6, 7, "409 VERSION_CONFLICT", 8, 10 and the many-concurrent test; Prompt 3 browser second-tab conflict |
| Decisions survive restarting the application | **Verified** | §3 (real process stop + restart, same DB, no reseed; API and direct DB read agree) |
| Clean checkout: install / env / migrate / seed / start / documented sign-in / tests | **Verified** | §2 #8–#12 |
| Type check, backend tests, production build | **Verified** | §2 #3–#5 |
| Browser UI checks for the completed flow | **Verified at Prompt 3, not re-run in Prompt 4** | `docs/build-log.md` § Prompt 3; UI code unchanged since |
| `npm run lint` | **Not run / removed** | no ESLint configuration in this prototype |

Failed checks: none.

## 6. Failures encountered during verification (not application defects)

- First persistence-test target `KYC-1003` was already `ESCALATED` in the seed
  → `409 CASE_NOT_PENDING`; re-run on pending `KYC-1012`. (Useful negative check.)
- Stopping `npm run start` by killing the npm wrapper left the `next-server`
  child alive (port still answering, restart failed with `EADDRINUSE`). Killed
  `next-server` explicitly, confirmed the port was closed, then restarted.
  Operational only.
- A throw-away inspection script using top-level `await` needed a `.mts`
  extension under `tsx`.

## 7. Unfinished / deferred work

- ESLint configuration (removed the non-functional `lint` script instead).
- Escalation resolution flow (supervisor queue) — intentionally out of scope.
- PostgreSQL migration and re-testing of concurrency behaviour.
- Tamper-evident audit storage; SSO (Microsoft Entra ID); MFA; account provisioning.
- Pagination for larger queues; live-updating ages in the queue.
- No public preview deployment (local `npm run dev` only, by the working rules).
- Browser checks were not repeated in Prompt 4; the Prompt 3 recording/notes are the evidence.
