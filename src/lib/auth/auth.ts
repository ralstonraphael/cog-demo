import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "@/lib/db";

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const SESSION_REFRESH_SECONDS = 60 * 30;

const MIN_SECRET_LENGTH = 32;

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  if (value.startsWith("replace-")) {
    throw new Error(`${name} still holds the placeholder from .env.example; set a real local value.`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters.`);
  }
  return value;
}

export function createAuth(db: typeof prisma) {
  return betterAuth({
    appName: "Operations Workbench",
    secret: requireEnv("BETTER_AUTH_SECRET", MIN_SECRET_LENGTH),
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

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Builds the auth instance on first use so `next build` does not need runtime secrets. */
export function getAuth(): Auth {
  instance ??= createAuth(prisma);
  return instance;
}

export const auth: Auth = new Proxy({} as Auth, {
  get: (_target, prop) => Reflect.get(getAuth(), prop),
  has: (_target, prop) => prop in getAuth(),
});
