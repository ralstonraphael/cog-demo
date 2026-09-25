import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db";

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const SESSION_REFRESH_SECONDS = 60 * 30;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}

export function createAuth(db: typeof prisma) {
  return betterAuth({
    appName: "Operations Workbench",
    secret: requireEnv("BETTER_AUTH_SECRET"),
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
    database: prismaAdapter(db, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      // Accounts are provisioned by the seed command only.
      disableSignUp: true,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        // `input: false` prevents clients from supplying these on any request.
        role: { type: "string", required: false, defaultValue: "VIEWER", input: false },
        active: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      // Always validate against the database so logout/deactivation take effect immediately.
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { active: true },
            });
            if (!user?.active) {
              throw new APIError("FORBIDDEN", { message: "This account is inactive." });
            }
          },
        },
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, path: "/" },
    },
    plugins: [nextCookies()],
  });
}

export const auth = createAuth(prisma);
export type Auth = typeof auth;
