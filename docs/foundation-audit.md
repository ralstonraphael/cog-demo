# Step 1.5 — Foundation audit (consolidated)

**Status: READY FOR STEP 2.**

- **Audited revision:** `eb7ec790237afd628768cb0bbd452700bdd8a15c` (Prompt 1 foundation commit, `main` history). All three auditors ran `git rev-parse HEAD` on a detached checkout and reported this SHA. The later backend commit (`e6b1dc7`) was explicitly out of scope and was not inspected by any auditor.
- **Coordinator:** https://app.devin.ai/sessions/0e5389eb0c794bd3ab03e2e13464cec7
- **Window:** 00:17–00:33 UTC (≈16 min wall; children ran concurrently 00:19–00:27).
- **Application code changed during the audit:** none. Only `docs/foundation-audit.md` and `docs/build-log.md` are added/updated by this step.

## Child sessions (Managed Devins)

| # | Scope | Session | Reviewed SHA | Elapsed (self-reported) | Usage |
| - | ----- | ------- | ------------ | ----------------------- | ----- |
| 1 | Authentication & permission foundation | https://app.devin.ai/sessions/ead65b09b2044cca8297cf84eeb37f54 | `eb7ec790…8d15c` | ~7 min | ACUs not visible to the child; coordinator API reported `0.0` at settle time (see limitations) |
| 2 | Data model, seed consistency, persistence | https://app.devin.ai/sessions/a7d48cfced28488eb4d12d94d700660b | `eb7ec790…8d15c` | ~6–7 min | same |
| 3 | Reproducibility & Step 2 readiness | https://app.devin.ai/sessions/7484545b15ab4c758a99a0149c78494a | `eb7ec790…8d15c` | ~10 min | same |

Each child used its own clone, its own `.env` with locally generated values, and a disposable SQLite file. All three confirmed `git status` clean at the end (no tracked file modified). Full reports are attached to each session as `audit-report.md`.

## What was actually executed (union of the three reports)

- `npm ci` (143 packages, no peer conflicts), `npm run db:migrate`, `npm run db:seed` ×2–3, `npm run typecheck`, `npm run build`, `npm run start`/`npm run dev`, `npm test`, `npm run lint`, `npm run db:reset:destructive` (incl. `NODE_ENV=production` refusal).
- Live HTTP: sign-in for all three demo users; wrong password / unknown email → 401; anonymous `/` and `/app` → 307 `/sign-in`; signed-in `/sign-in` → 307 `/app`; sign-out → old cookie rejected (session row deleted); `expiresAt` in the past → rejected and purged; sign-up (with `role`/`active`) → 400 disabled; sign-in body with `role`/`active` → ignored; `update-user` with `role` → 400 `FIELD_NOT_ALLOWED`; foreign `Origin` on sign-in/sign-out → 403; deactivated user → `/app` 307 and new sign-in 403.
- Helper checks (disposable script, explicit `Headers`): VIEWER → `requireReviewer` 403; anonymous / forged cookie / `x-user-role` header → 401; REVIEWER passes.
- SQL/Prisma inspection of the seeded DB: 2 REVIEWER + 1 VIEWER (all active); 20 distinct cases = 14 PENDING v0 + 2 APPROVED v1 + 2 REJECTED v1 + 2 ESCALATED v1; 6 DECISION events with `previousStatus=PENDING`, `newStatus==case.status`, `previousVersion=0`, `newVersion=1==case.version`, reviewer actors; KYC-1007 / Morgan Ellis / MEDIUM / MANUAL_REVIEW / MISMATCH / MATCH / `SIM-KYC-1007` exact; zero rows for every inconsistency query.
- Schema readiness simulation (raw SQL): conditional `UPDATE … WHERE id=? AND status='PENDING' AND version=0` → 1 row, stale repeat → 0 rows; duplicate `(caseId, newVersion)` insert rejected; FK violations rejected; `ON DELETE RESTRICT` blocks deleting a case with history; queue and history queries use the intended indexes (`EXPLAIN QUERY PLAN`).
- Startup does not seed/reset: row counts and `MAX(updatedAt)` identical before/after `build` + `dev`; no `seed`/`reset` imports under `src/`.
- Persistence: file-backed `DATABASE_URL` (`file:`), data survived build + restart, `prisma/*.db` and `.env` gitignored; only `.env.example` tracked; no secrets or `process.env` in client files; single commit history.

## Findings

No **BLOCKER** was reported by any auditor, and the coordinator found none on evidence review. Per the user's definition (broken login, trusted client roles, destructive startup, schema unable to support the operation) none of those conditions exist at `eb7ec79`.

### Confirmed defects — IMPORTANT (fix in the next implementation step; not gating)

| ID | Title | Source | Evidence / coordinator verification | Smallest fix | Verify with |
| -- | ----- | ------ | ---------------------------------- | ------------ | ----------- |
| C1 | Deactivated user's existing session is not revoked; better-auth's own `GET /api/auth/get-session` still returns it | A1-F1 | Child: after `UPDATE user SET active=0`, `/app` → 307 and new sign-in → 403 (correct), but `get-session` with the old cookie → 200 with `active:false` user. Coordinator: confirmed by code — `src/lib/auth/auth.ts` hook guards session *creation* only; `active` is enforced in `src/lib/auth/current-user.ts:37-41`. Every implemented data path goes through `getCurrentUser`, so the app itself rejects correctly. | In `getCurrentUser`, when `!user.active` delete that user's sessions (`prisma.session.deleteMany({ where: { userId } })`) before returning `null`; document "never call `auth.api.getSession`/`authClient.getSession` directly — use `current-user.ts`". | Deactivate a temp user, then `curl -b cookie /api/auth/get-session` → `null`; `npm run typecheck`; `npx vitest run`. |
| C2 | An unedited copy of `.env.example` is accepted as a working configuration | A3-F1 | Child: `cp .env.example .env && npm run db:migrate && npm run db:seed` succeeds; placeholder passwords (≥8 chars) and 38-char placeholder secret pass. Coordinator: confirmed by code — `requireEnv` checks truthiness only (`src/lib/auth/auth.ts:10-16`), seed checks `length < 8` only (`prisma/seed.ts:21-24`). Committed values are placeholders, not real secrets, so the "no secrets committed" requirement is still met; the gap is that a forgotten edit does not fail loudly. | Reject values starting with `replace-` and enforce `BETTER_AUTH_SECRET.length >= 32` in `requireEnv`/seed. | `cp .env.example .env && npm run db:seed` → exits non-zero with a clear message. |
| C3 | `npm run build` requires `BETTER_AUTH_SECRET` (auth constructed at module scope) | A3-F2 | Child: build without `.env` fails during "collect page data for /" with `Missing required environment variable BETTER_AUTH_SECRET`; with `.env` it passes. Coordinator: confirmed structurally — `export const auth = createAuth(prisma)` at `src/lib/auth/auth.ts:67`, imported by server pages/route. Local dev is unaffected; matters for CI/container builds. | Construct `auth` lazily on first use, **or** document `BETTER_AUTH_SECRET` as a build-time requirement (the Prompt 2 test setup already injects a test-only secret). | `env -u BETTER_AUTH_SECRET npm run build` with `.env` moved aside → exit 0 (after fix), or README states the requirement. |

### Confirmed defects — OPTIONAL (hygiene; no impact on Step 2 correctness)

| ID | Title | Source(s) | Evidence | Smallest fix |
| -- | ----- | --------- | -------- | ------------ |
| O1 | Anonymous `/app` logs an unhandled `AuthError` stack per request (layout redirects, page's `requireUser()` throws concurrently); response is still a correct 307 | A1-F2, A3-F6 (duplicate) | Dev and prod logs show `⨯ Error [AuthError]: Authentication required.` at `src/app/app/page.tsx:6` on each anonymous hit | In `page.tsx` use `getCurrentUser()` + `redirect("/sign-in")` (or rely on the layout only); route handlers map `AuthError.status` → response (Prompt 2 already does this in `src/lib/http/api.ts`). |
| O2 | `npm run lint` (`next lint`) is non-functional: prints a deprecation and blocks on an interactive ESLint setup prompt; no ESLint installed/configured | A3-F3 (also noted in Prompt 2 build log) | `npm run lint` hangs in non-interactive shells | Remove the script or add `eslint` + `eslint-config-next` flat config and switch to `eslint .`. |
| O3 | `npm test` exits 1 at this checkpoint — no test files or vitest config (README documents the command) | A3-F5, A2 #30, A1 | "No test files found, exiting with code 1" | Already addressed by the later backend commit (`e6b1dc7` adds `vitest.config.ts` + 22 tests); no action at `eb7ec79`. |
| O4 | `db:reset:destructive` target comes from ambient `DATABASE_URL` first (`--env-file` does not override existing shell vars), guarded only by `NODE_ENV` and does not echo the target | A3-F4 | `DATABASE_URL=file:./x.db npm run db:reset:destructive` acted on the shell-provided file | Log `DATABASE_URL`, require `file:` prefix in `prisma/reset.ts`. (Prompt 2 tests set `DATABASE_URL` to a temp path explicitly before importing `src/lib/db.ts`.) |
| O5 | Re-seeding refreshes demo users' `name`/`email`/`role` and password hash (never `active`, never cases/events) | A2-5.3, A1-N2 (duplicate) | `usersUpdated: 3` on rerun; cases `casesSkipped: 20` | None required (matches "do not overwrite decisions"); optionally document in README. |
| O6 | Undocumented local assumptions: nvm-only Node (no `engines`/`.nvmrc`; `--env-file` needs Node ≥ 20.6), `db:generate` not mentioned, `BETTER_AUTH_URL` must equal the browser origin/port, `Secure` cookie under `npm run start` | A3-F7, A1-F4 | Sign-in from a different port/host alias → 403 `INVALID_ORIGIN` | `"engines": {"node": ">=20.6"}`, `.nvmrc`, one README line each. Final README is Step 4 work. |

### Unverified concerns (kept separate; not defects at this checkpoint)

| ID | Concern | Source | Note |
| -- | ------- | ------ | ---- |
| U1 | Raw-SQL writes would bypass `@updatedAt` and Prisma's integer epoch-ms DateTime storage (mixed TEXT/INTEGER) | A2-5.1 | Only observed via the auditor's own raw-SQL simulation. The backend commit uses `tx.kycCase.updateMany` + `tx.auditEvent.create` through the Prisma client, so this does not arise. |
| U2 | `AuditEvent.createdAt` is caller-settable (seed back-dates historical events legitimately) | A2-5.2 | Server-timestamp requirement is met as long as the decision service never forwards a client value; the Prompt 2 request schema rejects unknown fields and the service omits `createdAt`. |
| U3 | Enum columns are plain `TEXT` without `CHECK` (standard Prisma-on-SQLite) | A2-5.4 | Safe while writes go through the Prisma client. |
| U4 | No index on `audit_event.actorId` | A2-5.5 | Irrelevant at 20 cases; no "events by actor" query planned. |
| U5 | Sign-in JSON echoes the raw session token in the body (better-auth default for bearer flows) in addition to the HttpOnly cookie | A1-F3 | App never reads `token`; only relevant if XSS exists. Optional `hooks.after` strip. |
| U6 | better-auth rate limiting disabled outside production (library default) | A1-F5 | Acceptable for a synthetic demo. |
| U7 | `npm ci --ignore-scripts` would skip Prisma client generation | A3-F7.3 | Not executed. |
| U8 | Sliding-session refresh from server components extends `expiresAt` in DB but cannot re-emit the cookie; effective session bounded to 8h from login | A1-N3 | Not a security issue. |

### Not defects (spec-vs-implementation notes)

- Password hash lives on better-auth's credential `Account` row rather than `User` (documented in `docs/build-log.md`); functionally equivalent and matches the library's documented model (A1-N1, A2).
- Decision endpoints, reviewer UI, transaction rollback, and concurrency were not assessed at `eb7ec79` — scheduled later work, as instructed.

## Planned later checks (recorded by the auditors as not testable at `eb7ec79`)

- Endpoint-level authorization for `GET /api/kyc-cases`, `GET /api/kyc-cases/:id`, `POST /api/kyc-cases/:id/decisions` (401/403/400/404/409).
- Transactional rollback when the audit insert fails; concurrent decisions on one case/version → exactly one commit.
- Case API responses exclude `account.password`/`session` fields; `AuditEvent.createdAt` never taken from the request.
- Test isolation (`DATABASE_URL` for vitest).

(These are implemented and tested in the later backend commit `e6b1dc7` — 22/22 vitest — but that commit was not part of this audit.)

## Audit limitations

- No `sqlite3` CLI on the child machines; SQL inspection used disposable `tsx` scripts with `prisma.$queryRawUnsafe`.
- Children ran the dev/prod server on non-3000 ports and exercised origin checks with explicit `Origin` headers; browser-based sign-in was not performed (curl only).
- ACU usage is not visible from inside a child session, and the coordinator's session API reported `0.0` ACUs for each child at settle time, which is likely a reporting lag rather than actual zero usage; treat usage as "not reliably reported".
- Coordinator verification of C1–C3 was by code inspection of the unchanged `src/lib/auth/*` and `prisma/seed.ts` (identical between `eb7ec79` and `e6b1dc7`); the children's reproduction commands were not re-run to stay within the 15-minute allowance.

## Conclusion

**READY FOR STEP 2.** No confirmed blocker. Three IMPORTANT, non-gating defects (C1–C3) should be fixed in the next implementation step; smallest fixes and verification commands are listed above.
