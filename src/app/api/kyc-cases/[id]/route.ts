import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { errorResponse, handleRouteError, jsonResponse } from "@/lib/http/api";
import { CASE_ID_PATTERN, getCaseDetail } from "@/lib/kyc/queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/kyc-cases/:id */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireUser(request.headers);
    const { id } = await context.params;
    if (!CASE_ID_PATTERN.test(id)) {
      return errorResponse(404, "CASE_NOT_FOUND", "Case not found.");
    }
    const detail = await getCaseDetail(prisma, id);
    if (!detail) return errorResponse(404, "CASE_NOT_FOUND", "Case not found.");
    return jsonResponse({ case: detail });
  } catch (error) {
    return handleRouteError(error);
  }
}
