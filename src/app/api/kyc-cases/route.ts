import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { errorResponse, handleRouteError, jsonResponse } from "@/lib/http/api";
import { listCases, parseCaseListFilters, SEARCH_MAX_LENGTH } from "@/lib/kyc/queries";

export const dynamic = "force-dynamic";

/** GET /api/kyc-cases?status=PENDING|APPROVED|REJECTED|ESCALATED|ALL&risk=LOW|MEDIUM|HIGH&q=text */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireUser(request.headers);
    const filters = parseCaseListFilters(new URL(request.url).searchParams);
    if (!filters) {
      return errorResponse(
        400,
        "INVALID_FILTER",
        `status must be PENDING, APPROVED, REJECTED, ESCALATED or ALL; risk must be LOW, MEDIUM or HIGH; q must be at most ${SEARCH_MAX_LENGTH} characters.`,
      );
    }
    const cases = await listCases(prisma, filters);
    return jsonResponse({ cases, filters });
  } catch (error) {
    return handleRouteError(error);
  }
}
