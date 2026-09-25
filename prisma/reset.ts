/**
 * DESTRUCTIVE local development reset: `npm run db:reset:destructive`.
 *
 * Deletes ALL audit events, cases, sessions, accounts and users, then re-runs
 * the seed. Refuses to run when NODE_ENV=production or when DATABASE_URL is
 * not a local SQLite file, and prints the target before deleting anything.
 */
import { PrismaClient } from "@prisma/client";
import { seed } from "./seed";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset the database with NODE_ENV=production.");
  }
  const target = process.env.DATABASE_URL ?? "";
  if (!target.startsWith("file:")) {
    throw new Error("Refusing to reset: DATABASE_URL must point at a local SQLite file (file:...).");
  }
  console.log(`Resetting SQLite database ${target} (relative paths resolve from prisma/).`);
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.auditEvent.deleteMany(),
      prisma.kycCase.deleteMany(),
      prisma.session.deleteMany(),
      prisma.account.deleteMany(),
      prisma.verification.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    console.log("All application data deleted.");
    const summary = await seed(prisma);
    console.log("Re-seed complete:", summary);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Reset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
