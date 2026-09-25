import { auth } from "@/lib/auth/auth";
import type { CurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { GET as listCasesRoute } from "@/app/api/kyc-cases/route";
import { GET as caseDetailRoute } from "@/app/api/kyc-cases/[id]/route";
import { POST as decisionRoute } from "@/app/api/kyc-cases/[id]/decisions/route";
import { seed } from "../prisma/seed";

export const ORIGIN = "http://localhost:3000";

export const ACCOUNTS = {
  alex: { email: "alex@demo.test", password: "alex-test-password" },
  sam: { email: "sam@demo.test", password: "sam-test-password" },
  taylor: { email: "taylor@demo.test", password: "taylor-test-password" },
} as const;

export async function resetAndSeed() {
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.kycCase.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await seed(prisma, process.env);
}

/** Signs in through better-auth and returns the Cookie header value for subsequent requests. */
export async function signIn(account: keyof typeof ACCOUNTS): Promise<string> {
  const response = await auth.api.signInEmail({
    body: { email: ACCOUNTS[account].email, password: ACCOUNTS[account].password },
    headers: new Headers({ origin: ORIGIN }),
    asResponse: true,
  });
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`);
  const setCookie = response.headers.getSetCookie();
  const sessionCookie = setCookie.find((c) => c.startsWith("better-auth.session_token="));
  if (!sessionCookie) throw new Error("no session cookie returned");
  return sessionCookie.split(";")[0] ?? "";
}

export async function currentUserFor(account: keyof typeof ACCOUNTS): Promise<CurrentUser> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: ACCOUNTS[account].email },
    select: { id: true, name: true, email: true, role: true },
  });
  return user;
}

type RequestOptions = {
  cookie?: string;
  origin?: string | null;
  body?: unknown;
  rawBody?: string;
  extraHeaders?: Record<string, string>;
};

function buildRequest(method: string, path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.extraHeaders ?? {});
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers.set("content-type", "application/json");
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }
  return new Request(`${ORIGIN}${path}`, { method, headers, body });
}

export async function listCases(query = "", options: RequestOptions = {}) {
  const response = await listCasesRoute(buildRequest("GET", `/api/kyc-cases${query}`, options));
  return { status: response.status, json: await response.json() };
}

export async function getCase(id: string, options: RequestOptions = {}) {
  const response = await caseDetailRoute(buildRequest("GET", `/api/kyc-cases/${id}`, options), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, json: await response.json() };
}

export async function postDecision(id: string, options: RequestOptions = {}) {
  const response = await decisionRoute(buildRequest("POST", `/api/kyc-cases/${id}/decisions`, options), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, json: await response.json(), headers: response.headers };
}

export async function snapshotCase(id: string) {
  const row = await prisma.kycCase.findUniqueOrThrow({
    where: { id },
    select: { status: true, version: true, events: { select: { id: true, actorId: true, reason: true, newVersion: true, newStatus: true } } },
  });
  return row;
}
