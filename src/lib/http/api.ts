import { AuthError } from "@/lib/auth/current-user";

const NO_STORE = { "Cache-Control": "no-store, private", Vary: "Cookie" } as const;

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...extraHeaders },
  });
}

export function errorResponse(status: number, code: string, message: string, extraHeaders?: Record<string, string>): Response {
  return jsonResponse({ error: { code, message } }, status, extraHeaders);
}

/** Maps helper/unknown errors to safe responses; never leaks stack traces or DB errors. */
export function handleRouteError(error: unknown): Response {
  if (error instanceof AuthError) {
    return errorResponse(error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", error.message);
  }
  console.error("Unhandled API error:", error);
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function trustedOrigin(): string {
  return new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
}

/**
 * CSRF guard for cookie-authenticated state-changing requests. Browsers always
 * send `Origin` on cross-origin POSTs and on same-origin fetch/XHR POSTs, so a
 * missing or foreign Origin is rejected. `Sec-Fetch-Site` is checked as a
 * second signal when present.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (!origin) return false;
  return origin === trustedOrigin();
}

export async function readJsonBody(request: Request): Promise<unknown | undefined> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return undefined;
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
