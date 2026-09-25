# Operations Workbench — KYC Review prototype

Internal-tools prototype: a human reviewer inspects **synthetic** customer
identity-check results and approves, rejects, or escalates a KYC case. The app
records the decision together with a durable audit event. It performs no
identity verification and touches no external services. **All customers,
evidence and accounts are synthetic demo data.**

Stack: Next.js 15 (App Router, TypeScript) · Prisma 6 · file-backed SQLite · better-auth 1.7.

[Watch the 4:49 demo](https://www.loom.com/share/7a82bc3376074a839c84fedef892d524). The prototype runs locally; there is no hosted application.

## 1. What the prototype demonstrates

- A **reviewer queue** (`/kyc`) of pending synthetic cases with status/risk filters and search.
- A **case detail** page (`/kyc/KYC-1007`) showing structured synthetic check
  results (document check, name consistency, address check, provider reference,
  explanation) and the case's chronological decision history.
- A **reviewer decision** (Approve / Reject / Escalate + mandatory reason,
  confirmation dialog) recorded by a server-side service that performs a
  conditional case update and an audit insert **in one database transaction**,
  with optimistic concurrency (`expectedVersion`) so stale or competing
  decisions are rejected with `409` instead of overwriting the accepted result.
- A **fictional demonstration policy** (maintenance experiment, see
  `docs/verification.md` §8): HIGH-risk cases cannot be approved directly —
  only rejected or escalated. The server enforces it from the persisted risk
  level (`422 HIGH_RISK_REQUIRES_ESCALATION`, no state or audit change); the UI
  hides Approve for such cases and explains why. This is not a claim about any
  client's actual policy or regulatory obligations.
- **Role-aware access**: reviewers decide; viewers can read cases and history
  but every mutation path (UI and direct API) rejects them server-side.
- **Durable audit history**: decisions and their audit events survive an
  application restart (verified in `docs/verification.md`).

## 2. Prerequisites and setup

Prerequisites: **Node.js ≥ 20.6** (the author used Node 24 / npm 10; `.nvmrc`
says `24`, `package.json` declares `engines.node >=20.6` because the seed
scripts use `node --env-file`). Git. No other services; SQLite is bundled with
Prisma.

```bash
git clone https://github.com/ralstonraphael/cog-demo.git
cd cog-demo
# if you use nvm:  source ~/.nvm/nvm.sh && nvm use   (or: nvm install 24)

npm ci                      # install from the committed package-lock.json (also runs prisma generate)
cp .env.example .env        # then EDIT .env — see section 3; placeholders are rejected
npm run db:migrate          # prisma migrate deploy -> creates prisma/dev.db and applies committed migrations
npm run db:seed             # explicit, idempotent seed (3 users, 20 cases); never runs on startup
npm run dev                 # http://localhost:3000
```

`npm ci` prints 7 `npm audit` advisories; all are in transitive dev tooling
(`@vitest/mocker`, `postcss`, `deepmerge-ts`), none in the runtime bundle.

## 3. Environment variables

Copy `.env.example` to `.env` and replace every placeholder. Values starting
with `replace-` are rejected by both the app and the seed. **Never commit
`.env`** (it is git-ignored).

| Variable | Placeholder in `.env.example` | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | SQLite file. Relative paths resolve from the `prisma/` directory, so the default is `prisma/dev.db`. |
| `BETTER_AUTH_SECRET` | `replace-with-32-plus-random-characters` | Session signing secret, **≥ 32 characters** (e.g. `openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Public origin of the app. Must match the port you serve on; sign-in and decision requests from another origin get `403`. |
| `SEED_PASSWORD_ALEX` | `replace-me-alex` | Demo password for Alex Reviewer, ≥ 8 characters. |
| `SEED_PASSWORD_SAM` | `replace-me-sam` | Demo password for Sam Reviewer, ≥ 8 characters. |
| `SEED_PASSWORD_TAYLOR` | `replace-me-taylor` | Demo password for Taylor Viewer, ≥ 8 characters. |

What happens when something is wrong: missing `DATABASE_URL` → Prisma error on
the first query; missing/placeholder/short `BETTER_AUTH_SECRET` → the first
request that needs auth fails with a clear message (the build itself does not
need the secret); placeholder or short `SEED_PASSWORD_*` → `npm run db:seed`
exits 1 with the variable name.

## 4. Migrations and seed

- `npm run db:migrate` — `prisma migrate deploy`: applies `prisma/migrations/*` to `DATABASE_URL`. Safe to re-run.
- `npm run db:seed` — `tsx --env-file=.env prisma/seed.ts`: upserts the 3 demo
  users (passwords re-hashed from `.env`) and inserts any of the 20 synthetic
  cases that do not exist yet. **Existing cases and audit events are never
  modified**, so re-running after making decisions keeps them
  (`casesSkipped: 20`). The seed is never executed by `npm run dev` /
  `npm run start`.
- `npm run db:reset:destructive` — deletes **all** local users, sessions,
  cases and audit events in `DATABASE_URL`, then re-seeds. Prints the target
  first; refuses if `NODE_ENV=production` or if `DATABASE_URL` is not a
  `file:` SQLite URL. Local development only.
- `npm run db:migrate:dev` — create a new migration after editing `prisma/schema.prisma` (development only).

Seeded dataset: 20 deterministic cases `KYC-1001`…`KYC-1020` — 14 `PENDING`
(version 0), 2 `APPROVED`, 2 `REJECTED`, 2 `ESCALATED` (version 1, each with
one historical audit event). `KYC-1007` (Morgan Ellis, MEDIUM) has a name
mismatch flagged for manual review and is the suggested demo case.

## 5. Demo users and roles

| Name | Email | Role | Password |
| --- | --- | --- | --- |
| Alex Reviewer | `alex@demo.test` | `REVIEWER` — read cases, record decisions | `SEED_PASSWORD_ALEX` in your `.env` |
| Sam Reviewer | `sam@demo.test` | `REVIEWER` | `SEED_PASSWORD_SAM` |
| Taylor Viewer | `taylor@demo.test` | `VIEWER` — read cases and history only | `SEED_PASSWORD_TAYLOR` |

Passwords are hashed by better-auth (scrypt) at seed time; changing a value in
`.env` and re-running `npm run db:seed` updates that user's password. Sign-up
is disabled; there is no way to create accounts through the UI. Roles and the
`active` flag live on the user row and are resolved on the server for every
request; nothing client-supplied is used for authorization. Deactivating a user
(`active = false`) revokes their existing sessions on the next request.

## 6. Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` / `npm run start` | Production build / serve the build (`start` sets `Secure` cookies; use `http://localhost:3000` as `BETTER_AUTH_URL`) |
| `npm run typecheck` | `tsc --noEmit` — the static gate (no ESLint is configured in this prototype) |
| `npm test` | Vitest: 30 backend tests (auth, authorization, validation, transaction/rollback, concurrency, high-risk policy) against an **isolated temporary SQLite file** created in `tests/setup.ts`; your `prisma/dev.db` is never touched |
| `npm run db:*` | See section 4 |

Do not run `npm run build` while `npm run dev` is running against the same
checkout — both write `.next/`.

## 7. Walkthrough (60–90 seconds)

1. Sign in at `/sign-in` as **alex@demo.test**. You land on **`/kyc`**: the
   pending queue, oldest submission first, with status/risk filters and
   search. Try search `Morgan` → one result.
2. Open **`KYC-1007` (Morgan Ellis, MEDIUM)**. The "Synthetic check results"
   table shows *Document check: Manual review*, *Name consistency: Mismatch*,
   *Address check: Match*, provider reference `SIM-KYC-1007`, and a short
   explanation that the mismatch needs human review. History reads "No
   decisions recorded yet."
3. Choose **Escalate** (or Approve/Reject), type a reason of 10–500 characters,
   click **Review decision…**, check the summary in the confirmation dialog and
   confirm. The page shows the authoritative case returned by the server:
   status *Awaiting supervisor review*, version 1, the new highlighted audit
   event (actor, previous → new status, versions, reason, server UTC time),
   and no decision controls. Refresh — it is persisted. Back to the queue: the
   case is no longer pending.
4. Open another pending case in a second tab, decide it in the first tab, then
   decide in the second tab → exact message *"This case changed while you were
   reviewing it. Reload to see the latest decision."* with a Reload button;
   nothing was written by the losing request.
5. Log out, sign in as **taylor@demo.test** (viewer). Queue, detail and history
   are readable; the case page shows a "Read-only access" notice and no
   decision form. A direct `POST /api/kyc-cases/:id/decisions` with Taylor's
   session returns `403 FORBIDDEN`.
6. Transaction/conflict evidence: `src/lib/kyc/decision-service.ts` (single
   `$transaction`: conditional `updateMany` on `id + status=PENDING +
   version`, then `auditEvent.create`), `tests/decision-service.test.ts`
   (rollback when the audit insert fails, concurrent decisions → at most one
   transition and one event per case) and `tests/kyc-api.test.ts` (stale replay and competing
   decision → `409`). Results in `docs/verification.md`.

## 8. Repository organization

```
prisma/schema.prisma        User, Session, Account, Verification, KycCase, AuditEvent
prisma/migrations/          committed SQL migrations (prisma migrate deploy)
prisma/fixtures.ts          deterministic synthetic users/cases
prisma/seed.ts              explicit idempotent seed      (npm run db:seed)
prisma/reset.ts             destructive local reset       (npm run db:reset:destructive)
src/lib/db.ts               Prisma client singleton
src/lib/auth/auth.ts        better-auth server config (lazy; env validation; sign-up disabled)
src/lib/auth/current-user.ts getCurrentUser / requireUser / requireReviewer / requireUserOrRedirect
src/lib/auth/client.ts      browser auth client (sign-in / sign-out)
src/lib/http/api.ts         JSON responses (Cache-Control: no-store, private), error mapping, same-origin check
src/lib/kyc/queries.ts      list/detail queries, filter parsing, response projections
src/lib/kyc/decision-service.ts  decideCase: transactional conditional update + audit insert + retry
src/lib/kyc/types.ts, evidence.ts, labels.ts, filters-url.ts   shared types, evidence parsing, labels, URL helpers
src/app/sign-in/            sign-in page
src/app/(shell)/            authenticated shell: layout, /kyc queue, /kyc/[id] detail + decision form
src/app/api/auth/[...all]   better-auth handler
src/app/api/kyc-cases/      GET list, GET :id, POST :id/decisions
tests/                      Vitest suite + isolated-SQLite setup (tests/setup.ts)
docs/build-log.md           timeline, decisions, corrections across prompts
docs/verification.md        commands run, results, acceptance matrix
docs/foundation-audit.md    Step 1 audit findings and their fixes
```

HTTP API (all responses `Cache-Control: no-store, private`, `Vary: Cookie`):

| Route | Access | Notes |
| --- | --- | --- |
| `GET /api/kyc-cases?status=&risk=&q=` | any signed-in user | `401` anonymous, `400` invalid filter |
| `GET /api/kyc-cases/:id` | any signed-in user | evidence + ordered history with actor names; `404` unknown |
| `POST /api/kyc-cases/:id/decisions` | `REVIEWER` only, same-origin | body exactly `{ action, reason, expectedVersion }`; `401/403/400/404/409/422/503` (`422` = APPROVE on a pending HIGH-risk case) |

## 9. Prototype limitations

- **Synthetic data only.** Every customer, check result, provider reference and
  account is fabricated in `prisma/fixtures.ts`. Nothing is real personal data.
- **No identity verification is performed.** The "check results" are static
  fixtures; the app never calls a KYC provider, document scanner, sanctions
  list or any external API.
- **Human reviewers make the decisions.** The application only records what
  a signed-in reviewer chose and why; it recommends nothing.
- **Demo authentication.** Email/password via better-auth with seeded accounts
  and `.env` passwords. This is not Microsoft Entra ID / SSO, has no MFA,
  password reset, or account provisioning, and is not hardened for production.
- **SQLite is the prototype database.** Single file, single writer. Moving to
  PostgreSQL means regenerating migrations for the new provider and re-running
  the concurrency tests; that migration has **not** been tested.
- **Audit history is read-only through the application**, not tamper-proof:
  anyone with write access to the database file can alter or delete events.
  There is no hash chain, WORM storage or external log shipping.
- **Escalation resolution is intentionally deferred.** `ESCALATED` is a final
  state in this prototype ("Awaiting supervisor review"); there is no
  supervisor queue or re-assignment flow.
- **No integrations.** No production KYC provider, customer system, case
  management or financial service is connected. No email, notifications, or
  background jobs.
- Other gaps: no pagination (20-record dataset by design), no ESLint
  configuration (type checking is the gate), no public deployment.
