# Operations Workbench — KYC Review prototype

Internal-tools prototype: a human reviewer inspects **synthetic** customer
identity-check results and approves, rejects, or escalates a case. The app
records the decision. It performs no identity verification and touches no
external services. **All data is synthetic demo data.**

Stack: Next.js (App Router, TypeScript) · Prisma · file-backed SQLite · better-auth.

## Setup

```bash
npm install
cp .env.example .env        # then edit: set BETTER_AUTH_SECRET and the SEED_PASSWORD_* values
npm run db:migrate          # applies prisma/migrations to the SQLite file in DATABASE_URL
npm run db:seed             # explicit seed (never runs on startup; safe to re-run)
npm run dev                 # http://localhost:3000
```

Demo accounts (passwords come from your `.env`):

| Name           | Email            | Role     |
| -------------- | ---------------- | -------- |
| Alex Reviewer  | alex@demo.test   | REVIEWER |
| Sam Reviewer   | sam@demo.test    | REVIEWER |
| Taylor Viewer  | taylor@demo.test | VIEWER   |

## Commands

| Command                        | Purpose                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js app                                                                            |
| `npm run typecheck`            | `tsc --noEmit`                                                                            |
| `npm test`                     | Vitest suite (isolated temporary SQLite database)                                        |
| `npm run db:migrate`           | Apply committed migrations (`prisma migrate deploy`)                                     |
| `npm run db:migrate:dev`       | Create a new migration after editing `prisma/schema.prisma`                              |
| `npm run db:seed`              | Idempotent seed: adds missing users/cases, **never overwrites existing decisions**       |
| `npm run db:reset:destructive` | **Deletes all local data** (users, sessions, cases, events) and re-seeds. Local dev only. |

## Layout

- `prisma/schema.prisma`, `prisma/migrations/` — schema (User, Session, Account, Verification, KycCase, AuditEvent)
- `prisma/fixtures.ts`, `prisma/seed.ts`, `prisma/reset.ts` — deterministic synthetic fixtures and seed/reset commands
- `src/lib/auth/auth.ts` — better-auth server configuration (DB-backed sessions, HttpOnly cookies, origin/CSRF checks, sign-up disabled)
- `src/lib/auth/current-user.ts` — `getCurrentUser`, `requireUser`, `requireReviewer` server helpers
- `src/app/sign-in`, `src/app/app` — sign-in page and authenticated shell
- `docs/build-log.md` — implementation timeline

## Roles

- **REVIEWER** — read cases; decide pending cases.
- **VIEWER** — read cases and history only.

Roles and the active flag are stored on the user record and resolved on the
server for every request. Nothing client-supplied is used for authorization.
