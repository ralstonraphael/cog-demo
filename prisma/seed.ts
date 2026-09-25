/**
 * Explicit, idempotent seed: `npm run db:seed`.
 *
 * - Creates the demo users (or refreshes name/role/password of existing ones).
 * - Inserts any fixture cases that do not exist yet, with their historical
 *   decision events. Existing cases are never modified, so decisions recorded
 *   through the app survive re-seeding.
 *
 * Never runs on application startup. For a destructive reset use
 * `npm run db:reset:destructive`.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { CASE_FIXTURES, USER_FIXTURES } from "./fixtures";
import { serializeEvidence } from "../src/lib/kyc/evidence";

export async function seed(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  const summary = { usersCreated: 0, usersUpdated: 0, casesCreated: 0, eventsCreated: 0, casesSkipped: 0 };

  for (const fixture of USER_FIXTURES) {
    const password = env[fixture.passwordEnv];
    if (!password || password.length < 8) {
      throw new Error(`Environment variable ${fixture.passwordEnv} must be set (>= 8 chars). See .env.example.`);
    }
    if (password.startsWith("replace-")) {
      throw new Error(`${fixture.passwordEnv} still holds the placeholder from .env.example; set a real local value.`);
    }
    const passwordHash = await hashPassword(password);
    const existing = await prisma.user.findUnique({ where: { id: fixture.id }, select: { id: true } });

    await prisma.user.upsert({
      where: { id: fixture.id },
      create: {
        id: fixture.id,
        name: fixture.name,
        email: fixture.email,
        emailVerified: true,
        role: fixture.role,
        active: true,
        accounts: {
          create: {
            id: `acc_${fixture.id}`,
            accountId: fixture.id,
            providerId: "credential",
            password: passwordHash,
          },
        },
      },
      update: { name: fixture.name, email: fixture.email, role: fixture.role },
    });
    await prisma.account.upsert({
      where: { id: `acc_${fixture.id}` },
      create: { id: `acc_${fixture.id}`, accountId: fixture.id, providerId: "credential", userId: fixture.id, password: passwordHash },
      update: { password: passwordHash },
    });
    if (existing) summary.usersUpdated += 1;
    else summary.usersCreated += 1;
  }

  for (const fixture of CASE_FIXTURES) {
    const exists = await prisma.kycCase.findUnique({ where: { id: fixture.id }, select: { id: true } });
    if (exists) {
      summary.casesSkipped += 1;
      continue;
    }
    const decided = fixture.status !== "PENDING";
    if (decided !== Boolean(fixture.decision)) {
      throw new Error(`Fixture ${fixture.id}: non-pending cases must have exactly one historical decision.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.kycCase.create({
        data: {
          id: fixture.id,
          customerName: fixture.customerName,
          submittedAt: new Date(fixture.submittedAt),
          riskLevel: fixture.riskLevel,
          evidence: serializeEvidence(fixture.evidence),
          status: fixture.status,
          version: decided ? 1 : 0,
        },
      });
      if (fixture.decision) {
        await tx.auditEvent.create({
          data: {
            id: `evt_${fixture.id}_1`,
            caseId: fixture.id,
            actorId: fixture.decision.actorId,
            type: "DECISION",
            previousStatus: "PENDING",
            newStatus: fixture.status,
            previousVersion: 0,
            newVersion: 1,
            reason: fixture.decision.reason,
            createdAt: new Date(fixture.decision.decidedAt),
          },
        });
        summary.eventsCreated += 1;
      }
    });
    summary.casesCreated += 1;
  }

  return summary;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const summary = await seed(prisma);
    console.log("Seed complete:", summary);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (`tsx prisma/seed.ts`), not when imported by tests.
if (process.argv[1] && /prisma[\\/]seed\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
