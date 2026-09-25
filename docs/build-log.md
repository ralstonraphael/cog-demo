# Build log — Operations Workbench (KYC review prototype)

Clock is cumulative across all prompts and is never reset.

- **Initial start:** 2026-09-25 00:00 UTC
- **Budget:** KYC milestone ≈ 65 min target; hard limit 120 min for the whole prototype.

| Prompt | Started (UTC) | Finished (UTC) | Prompt time | Cumulative |
| ------ | ------------- | -------------- | ----------- | ---------- |
| 1 — Foundation (schema, seed, auth, shell) | 00:00 | 00:10 | ~10 min | **~10 min** |

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

### Next step
Prompt 2: server-side case reads (`GET /api/kyc-cases`, `GET /api/kyc-cases/:id`) and the
transactional decision service + `POST /api/kyc-cases/:id/decisions`, all built on the
`requireUser` / `requireReviewer` helpers.
