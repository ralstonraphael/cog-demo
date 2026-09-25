import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";

/** Safe projection of the signed-in user. Never includes credentials or sessions. */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Resolves the current user from the session cookie in `requestHeaders`
 * (defaults to the incoming request headers for server components / route
 * handlers). Returns null for anonymous, expired, invalid, or inactive users.
 *
 * Role and active flag are always re-read from the database so authorization
 * never depends on client-supplied data.
 */
export async function getCurrentUser(requestHeaders?: Headers): Promise<CurrentUser | null> {
  const h = requestHeaders ?? (await headers());
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) return null;
  if (!user.active) {
    // Deactivation revokes every existing session so the library's own
    // session endpoint stops serving this user too.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    return null;
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** Throws AuthError(401) unless a valid, active session exists. */
export async function requireUser(requestHeaders?: Headers): Promise<CurrentUser> {
  const user = await getCurrentUser(requestHeaders);
  if (!user) throw new AuthError(401, "Authentication required.");
  return user;
}

/**
 * Server-page variant of `requireUser`: redirects anonymous users to sign-in
 * (returning them to `returnTo` afterwards) instead of throwing.
 */
export async function requireUserOrRedirect(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/** Throws AuthError(401) for anonymous users and AuthError(403) for non-reviewers. */
export async function requireReviewer(requestHeaders?: Headers): Promise<CurrentUser> {
  const user = await requireUser(requestHeaders);
  if (user.role !== "REVIEWER") {
    throw new AuthError(403, "Reviewer permission required.");
  }
  return user;
}
