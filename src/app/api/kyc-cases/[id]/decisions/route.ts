import { requireReviewer } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { errorResponse, handleRouteError, isSameOriginRequest, jsonResponse, readJsonBody } from "@/lib/http/api";
import { decideCase, decisionInputSchema } from "@/lib/kyc/decision-service";
import { CASE_ID_PATTERN } from "@/lib/kyc/queries";
import { HIGH_RISK_POLICY_MESSAGE } from "@/lib/kyc/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/kyc-cases/:id/decisions
 * Body: { action: "APPROVE" | "REJECT" | "ESCALATE", reason: string, expectedVersion: number }
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const actor = await requireReviewer(request.headers);
    if (!isSameOriginRequest(request)) {
      return errorResponse(403, "CSRF_REJECTED", "Cross-origin request rejected.");
    }

    const body = await readJsonBody(request);
    const parsed = decisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_DECISION",
        "Body must be exactly { action: APPROVE|REJECT|ESCALATE, reason: 10-500 chars, expectedVersion: non-negative integer }.",
      );
    }

    const { id } = await context.params;
    if (!CASE_ID_PATTERN.test(id)) {
      return errorResponse(404, "CASE_NOT_FOUND", "Case not found.");
    }

    const outcome = await decideCase(prisma, actor, id, parsed.data);
    switch (outcome.kind) {
      case "OK":
        return jsonResponse({ case: outcome.case, event: outcome.event });
      case "NOT_FOUND":
        return errorResponse(404, "CASE_NOT_FOUND", "Case not found.");
      case "POLICY_BLOCKED":
        return errorResponse(422, outcome.code, HIGH_RISK_POLICY_MESSAGE);
      case "CONFLICT":
        return jsonResponse(
          {
            error: {
              code: outcome.reason === "NOT_PENDING" ? "CASE_NOT_PENDING" : "VERSION_CONFLICT",
              message:
                outcome.reason === "NOT_PENDING"
                  ? `Case is already ${outcome.currentStatus}; no further decisions are allowed.`
                  : "Case was updated by someone else. Reload and review the latest version.",
              currentStatus: outcome.currentStatus,
              currentVersion: outcome.currentVersion,
            },
          },
          409,
        );
      case "RETRYABLE":
        return errorResponse(503, "DATABASE_BUSY", "The database is busy. Please retry.", { "Retry-After": "1" });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
