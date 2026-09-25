# Build log — Operations Workbench (KYC review prototype)

Clock is cumulative across all prompts and is never reset.

- **Initial start:** 2026-09-25 00:00 UTC
- **Budget:** KYC milestone ≈ 65 min target; hard limit 120 min for the whole prototype.

| Prompt | Started (UTC) | Finished (UTC) | Prompt time | Cumulative |
| ------ | ------------- | -------------- | ----------- | ---------- |
| 1 — Foundation (schema, seed, auth, shell) | 00:00 | 00:10 | ~10 min | ~10 min |
| 2 — Backend (reads, decision service, tests) | 00:10 | 00:18 | ~8 min | ~18 min |
| 1.5 — Parallel foundation audit (3 child sessions) | 00:17 | 00:33 | ~16 min | **~34 min** |

---

## Prompt 1 — Foundation

### Starting state
- `ralstonraphael/cog-demo` was an empty repository (no commits, no files). No existing
  work to preserve, so the app was scaffolded from scratch as a single Next.js application.
- Environment: Ubuntu, Node 24.19 (nvm), npm 10.8.

### Dependency choices
| Package | Version | Why |
| --- | --- | --- |
| next / react | 15.5.26 / 19.1.0 | Current stable App Router line |
| prisma / @prisma/client | 6.19.3 | Stable major with native SQLite (no driver adapter needed) |
| better-auth + @better-auth/prisma-adapter | 1.7.5 | Established auth library with a documented Prisma adapter and DB-backed server sessions; scrypt password hashing; HttpOnly cookies; origin-based CSRF checks. 1.7.5 chosen over 1.7.6 (published <7 days ago). |
| zod | 4.6.5 | Required by better-auth peer range; used for evidence/input validation |
| typescript | 5.9.3 | |
| vitest, tsx | 3.2.7, 4.20.3 | tests (prompt 2) and seed runner |

`npm audit` reports 7 advisories, all in transitive dev-tooling deps (`@vitest/mocker`, `postcss`, `deepmerge-ts`); not runtime-facing. Left as-is inside the timebox.

### Implemented
- **Schema + migration** `prisma/schema.prisma`, `prisma/migrations/20260925000355_init/`
  - `User` (id, name, unique email, `role` REVIEWER|VIEWER, `active`), `Session` (token, userId, expiresAt), `Account` (holds the scrypt password hash under better-auth's documented `credential` provider row), `Verification` (required by better-auth).
  - `KycCase` (stable id e.g. `KYC-1007`, customerName, submittedAt, riskLevel, JSON evidence, status, `version` default 0, updatedAt).
  - `AuditEvent` (cuid id, caseId + actorId FKs, type, previous/new status, previous/new version, reason, server `createdAt`), `@@unique([caseId, newVersion])`.
  - All `DateTime` values are stored as UTC ISO-8601 by Prisma/SQLite.
  - Note: the spec lists the password hash under `User`; better-auth's documented model stores it on the credential `Account` row instead. Kept the library's model rather than inventing a parallel one.
- **Seed** `prisma/fixtures.ts`, `prisma/seed.ts` (`npm run db:seed`)
  - 3 users (Alex/Sam REVIEWER, Taylor VIEWER), passwords read from `SEED_PASSWORD_*` env vars and hashed with better-auth's `hashPassword`.
  - Exactly 20 deterministic cases: 14 PENDING (v0), 2 APPROVED, 2 REJECTED, 2 ESCALATED (v1, each with one `DECISION` event from PENDING). `KYC-1007 / Morgan Ellis / MEDIUM / MANUAL_REVIEW, MISMATCH, MATCH / SIM-KYC-1007` included.
  - Idempotent: existing cases are skipped, so re-seeding never overwrites decisions. Not run on startup.
  - Destructive reset is a separately named command: `npm run db:reset:destructive` (refuses under `NODE_ENV=production`).
- **Auth** `src/lib/auth/auth.ts`, `src/lib/auth/current-user.ts`, `src/app/api/auth/[...all]/route.ts`
  - Email+password sign-in via better-auth; sign-up disabled; DB-backed sessions (8h TTL, cookie cache disabled so logout/deactivation are immediate); HttpOnly, SameSite=Lax, Secure in production; `trustedOrigins` + better-auth origin check for CSRF.
  - Inactive users blocked at sign-in (`databaseHooks.session.create.before`) and on every request (`getCurrentUser` re-reads `active`/`role` from DB).
  - Helpers: `getCurrentUser()`, `requireUser()` (401), `requireReviewer()` (403). `role`/`active` are `input: false` fields so they can never be set by a client request.
- **UI** `src/app/sign-in/*`, `src/app/app/*`: sign-in form, authenticated shell showing name + role badge + Log out, "Synthetic demo data" banner. `/` redirects based on session.

### Commands run and results
| Command | Result |
| --- | --- |
| `npm install` | 140 packages, OK |
| `npx prisma migrate dev --name init` | migration `20260925000355_init` created and applied; client generated |
| `npm run db:seed` (1st run) | `usersCreated: 3, casesCreated: 20, eventsCreated: 6` |
| `npm run db:seed` (2nd run) | `usersUpdated: 3, casesSkipped: 20` — no overwrites |
| DB inspection | users: 2 REVIEWER, 1 VIEWER · cases: 14 PENDING v0, 2 APPROVED v1, 2 REJECTED v1, 2 ESCALATED v1 · 6 audit events |
| `npx tsc --noEmit` | exit 0 |
| `npm run dev` + curl | anonymous `GET /app` → 307 `/sign-in`; `GET /sign-in` → 200 |
| sign-in alex/sam/taylor via `POST /api/auth/sign-in/email` | 200 each, `better-auth.session_token` cookie is HttpOnly; `GET /app` → 200 with cookie |
| wrong password | 401 |
| sign-in with `Origin: http://evil.example` | 403 (origin check) |
| `POST /api/auth/sign-up/email` | 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` |
| `POST /api/auth/sign-out` then `GET /app` with old cookie | 200 `{success:true}`; then 307 `/sign-in`; `get-session` → `null` |
| deactivate taylor (`active=false`) | existing session → 307 `/sign-in`; new sign-in → 403; reactivated afterwards |

### Blockers
- None. `@better-auth/prisma-adapter` is a separate package in 1.7.x and requires zod 4 (switched from zod 3).

### Next step (done in prompt 2)
Server-side case reads and the transactional decision service.

---

## Prompt 2 — Backend: reads, decision service, tests

No re-scaffold, no auth changes, demo DB (`prisma/dev.db`) untouched by tests.

### Files
| Path | Purpose |
| --- | --- |
| `src/lib/kyc/types.ts` | `CaseSummary`, `CaseDetail`, `DecisionEvent`, `DECISION_ACTIONS`, explicit `ACTION_TO_STATUS`, reason bounds (10–500) |
| `src/lib/kyc/evidence.ts` | zod schema for the structured synthetic evidence JSON |
| `src/lib/kyc/queries.ts` | `caseListFilterSchema` (strict), `listCases`, `getCaseDetail`, `detailInclude`/`toDetail` (queue/detail projections only — no auth/session/password fields) |
| `src/lib/kyc/decision-service.ts` | **Decision service** — `decideCase(db, actor, caseId, input)`, `decisionInputSchema`, `isTransientDbError` |
| `src/lib/http/api.ts` | JSON helpers (`Cache-Control: no-store, private`, `Vary: Cookie`), `handleRouteError` (never leaks stack/DB errors), `isSameOriginRequest`, `readJsonBody` |
| `src/app/api/kyc-cases/route.ts` | `GET /api/kyc-cases` |
| `src/app/api/kyc-cases/[id]/route.ts` | `GET /api/kyc-cases/:id` |
| `src/app/api/kyc-cases/[id]/decisions/route.ts` | `POST /api/kyc-cases/:id/decisions` (thin: auth → origin → validate → service → map outcome) |
| `tests/setup.ts`, `tests/helpers.ts` | temp SQLite file per run (`mkdtemp`), real `prisma migrate deploy`, real seed, real better-auth sign-in, route handlers invoked with `Request` objects |
| `tests/kyc-api.test.ts`, `tests/decision-service.test.ts` | 17 + 5 tests |

### Endpoint contracts
All responses are JSON with `Cache-Control: no-store, private`. Errors are `{ error: { code, message, ... } }`.

**`GET /api/kyc-cases?status=&risk=&q=`** — `requireUser` (401 if anonymous/expired/inactive).
- `status`: `PENDING` (default) | `APPROVED` | `REJECTED` | `ESCALATED` | `ALL`; `risk`: `LOW|MEDIUM|HIGH`; `q`: trimmed, ≤ 60 chars, matched against case id or customer name (`contains`). Unknown params or bad values → 400 `INVALID_FILTER`.
- Order: `submittedAt ASC, id ASC`.
- `200 { cases: [{ id, customerName, submittedAt, riskLevel, status, version, updatedAt }] }`.

**`GET /api/kyc-cases/:id`** — `requireUser`.
- `200 { case: { ...summary fields, evidence: { documentCheck, nameConsistency, addressCheck, providerReference, summary }, history: [{ id, type, previousStatus, newStatus, previousVersion, newVersion, reason, createdAt, actor: { id, name } }] } }` — history ordered `createdAt ASC, newVersion ASC`.
- 404 `CASE_NOT_FOUND` (only after auth).

**`POST /api/kyc-cases/:id/decisions`** — `requireReviewer` then same-origin check.
- Body exactly `{ action: "APPROVE"|"REJECT"|"ESCALATE", reason: string (10–500 after trim), expectedVersion: int ≥ 0 }`; any extra field (`actorId`, `role`, `status`, `timestamp`, …) → 400. Actor = session user.
- 401 unauthenticated · 403 `FORBIDDEN` (viewer) / `CSRF_REJECTED` (missing or foreign `Origin`) · 400 `INVALID_DECISION` (also for non-JSON / unparsable bodies) · 404 `CASE_NOT_FOUND` · 409 `CASE_NOT_PENDING` or `VERSION_CONFLICT` with `currentStatus`, `currentVersion` · 503 `DATABASE_BUSY` + `Retry-After: 1` (transient contention not resolved after 3 attempts).
- `200 { case: <CaseDetail as above, authoritative post-commit>, event: <the committed DecisionEvent> }`.

### Transaction design (`decideCase`)
One interactive transaction (5 s timeout):
1. `kycCase.updateMany({ where: { id, status: "PENDING", version: expectedVersion }, data: { status: newStatus, version: { increment: 1 } } })` — the guard is in the UPDATE predicate; no separate read-then-write.
2. `count !== 1` → abort (rollback) → re-read outside the tx to classify: 404 (no case), 409 `NOT_PENDING`, or 409 `VERSION_MISMATCH`.
3. `auditEvent.create({ actorId: session user, previousVersion: expectedVersion, newVersion: expectedVersion + 1, reason, type: "DECISION" })` — server timestamp; `@@unique(caseId, newVersion)` is a second, DB-level at-most-once guard.
4. Re-read the case + history inside the tx and return it.

Any throw after step 1 rolls back both writes. Transient SQLite contention (P2034/P2024/P2028, "database is locked"/`SQLITE_BUSY`) is retried ≤ 3 times (25 ms, 75 ms backoff) **with the caller's original `expectedVersion`** — the request is never re-based onto a newer version. A business conflict (`updateMany` count 0) is never retried. No external calls inside the transaction.

### Tests (isolated temp SQLite + real migrations)
`npx vitest run` → **2 files, 22 tests, 22 passed, 0 failed** (~14 s).

| Spec item | Test(s) |
| --- | --- |
| 1 anonymous list/detail rejected | `1. anonymous list/detail`, `signed-out session cookie is rejected` |
| 2 viewer reads, decision → 403 | `2. viewer can read…`, `2b. viewer's direct decision request returns 403 and writes nothing` |
| 3 client identity/role cannot authorize | `3. client-supplied identity or role fields cannot authorize a mutation` (viewer sending `actorId`/`role` → 403; reviewer sending them → 400, no writes) |
| 4 valid decision | `4. …changes status, increments version, and records one event` (actor Alex, exact reason, prev/new version 0→1) + action mapping test |
| 5 invalid input → no writes | `5. invalid bodies produce 400 and no writes` (bad action, blank/short/long reason, negative/float/string version, extra fields, arbitrary status, non-JSON) |
| 6 replay with old version | `6. repeated request with the old version returns 409 and creates no new event` |
| 7 stale competing decision | `7. different decision with a stale version cannot overwrite the winner` |
| 8 final states locked | `8. APPROVED, REJECTED and ESCALATED cases cannot transition again` |
| 9 audit failure rolls back | `9. rolls back the case update when audit insertion fails` — wraps the **real** Prisma transaction client so `auditEvent.create` throws; asserts from inside the same tx that the UPDATE had applied (`count === 1`), then asserts after rollback: PENDING/v0/0 events/6 total events. Also `rolls back when the audit unique constraint is violated` (real DB constraint, no mocking). No production failure switch exists. |
| 10 concurrency | `10. two concurrent decisions…` and `many concurrent decisions…` (6 writers × 3 cases): exactly one `OK`, the rest `CONFLICT` or `RETRYABLE`; DB ends with exactly one transition and one event per case. |
| extra | CSRF (missing/foreign Origin → 403), search/status/risk/`ALL`/default filters, invalid filter → 400, field projection (no email/hash/session), actor names in history, 404 ordering after auth |

**Rollback actually tested:** yes (injected failure + real unique-constraint failure). **Competing writes actually tested:** yes (in-process `Promise.all` against one SQLite file; only one winner observed in every run). Not observed: a genuine `SQLITE_BUSY` under Prisma's serialized SQLite connection in-process, so the 503 `DATABASE_BUSY` path is covered by the classification logic but was not hit organically.

### Commands run and results
| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 2 files / 22 tests passed |
| live `npm run dev` + curl (demo DB, read-only + rejected writes only) | anon `GET /api/kyc-cases` → 401; alex → 14 pending, first `KYC-1007`; `?status=ALL&risk=HIGH` → 6; `GET /api/kyc-cases/KYC-1007` → evidence + history; taylor POST → 403; alex short reason + `actorId` → 400; alex on APPROVED case → 409 `CASE_NOT_PENDING`; POST without `Origin` → 403 |

### Unresolved issues
- None failing. Noted: `npm run lint` (`next lint`) is not configured (no ESLint config was scaffolded); type checking is the gate for now.

### What the UI can rely on
- Every case payload carries `status` + `version`; send `version` back as `expectedVersion`.
- 409 always includes `currentStatus`/`currentVersion` so the UI can reload and show "changed by someone else" without guessing.
- Detail `history` is ordered, includes actor display names, and contains the committed event after a successful decision (also returned as `event`).
- Viewer vs reviewer is decided server-side; the UI may hide buttons for viewers, but the server will 403 regardless.
- Responses are never cached (`no-store, private`).

### Next step
Prompt 3: reviewer interface (queue with filters/search, case detail with evidence + history,
decision form with reason + optimistic-concurrency handling), server-rendered pages calling
the same `requireUser`/`requireReviewer` helpers.

---

## Step 1.5 — Parallel foundation audit (coordinator)

- **Window:** 00:17–00:33 UTC (~16 min; target was 15). Cumulative **~34 min** of the 120-min hard limit.
- **Audited revision:** `eb7ec790237afd628768cb0bbd452700bdd8a15c` (Prompt 1 foundation commit). Chosen because the user framed decision endpoints as not yet built for this audit; the Prompt 2 commit `e6b1dc7` was left untouched and unaudited. Checkpoint hygiene verified before launch: no `.env`, `*.db`, `node_modules`, `.next` tracked; only `.env.example` placeholders.
- **Child sessions (Managed Devins, launched concurrently 00:19 UTC, all detached to the same SHA):**
  1. Auth & permission foundation — https://app.devin.ai/sessions/ead65b09b2044cca8297cf84eeb37f54 (~7 min)
  2. Data model, seed, persistence — https://app.devin.ai/sessions/a7d48cfced28488eb4d12d94d700660b (~6–7 min)
  3. Reproducibility & Step 2 readiness — https://app.devin.ai/sessions/7484545b15ab4c758a99a0149c78494a (~10 min)
- **Reported usage:** ACUs not visible inside the children; coordinator API showed `0.0` per child at settle time (likely reporting lag) — not reliably reported.
- **Outcome:** **READY FOR STEP 2.** 0 BLOCKER; 3 IMPORTANT non-gating confirmed defects (inactive user's session not revoked at the library `get-session` endpoint; unedited `.env.example` accepted; `next build` requires `BETTER_AUTH_SECRET`); 6 OPTIONAL hygiene items; 8 unverified concerns kept separate. Full consolidation, smallest fixes, and verification commands: `docs/foundation-audit.md`.
- **Application code changed in this step:** none.

### Next step
Prompt 3: reviewer interface. Fold the three IMPORTANT audit fixes (C1–C3 in `docs/foundation-audit.md`) into that step.
