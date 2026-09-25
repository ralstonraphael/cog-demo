/**
 * Vitest setup: points Prisma at an isolated temporary SQLite file and applies
 * the real migrations before any application module is imported. The
 * development database (prisma/dev.db) is never touched.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "kyc-test-"));
const dbPath = path.join(dir, "test.db");

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.BETTER_AUTH_SECRET = "test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.SEED_PASSWORD_ALEX = "alex-test-password";
process.env.SEED_PASSWORD_SAM = "sam-test-password";
process.env.SEED_PASSWORD_TAYLOR = "taylor-test-password";

execFileSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});
