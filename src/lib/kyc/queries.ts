import { CaseStatus, Prisma, RiskLevel, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseEvidence } from "@/lib/kyc/evidence";
import type { CaseDetail, CaseSummary, DecisionEvent } from "@/lib/kyc/types";

export const SEARCH_MAX_LENGTH = 60;
export const CASE_ID_PATTERN = /^KYC-\d{1,10}$/;

export const caseListFilterSchema = z
  .object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "ESCALATED", "ALL"]).default("PENDING"),
    risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    q: z.string().trim().max(SEARCH_MAX_LENGTH).optional(),
  })
  .strict();

export type CaseListFilters = {
  status: CaseStatus | "ALL";
  risk?: RiskLevel;
  q?: string;
};

/**
 * Parses and validates queue filters from URL search params.
 * Returns null when a value is invalid (caller responds 400).
 */
export function parseCaseListFilters(searchParams: URLSearchParams): CaseListFilters | null {
  const raw: Record<string, string> = {};
  for (const key of ["status", "risk", "q"] as const) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  const result = caseListFilterSchema.safeParse(raw);
  if (!result.success) return null;
  return {
    status: result.data.status,
    risk: result.data.risk,
    q: result.data.q || undefined,
  };
}

const summarySelect = {
  id: true,
  customerName: true,
  submittedAt: true,
  riskLevel: true,
  status: true,
  version: true,
  updatedAt: true,
} as const;

type SummaryRow = {
  id: string;
  customerName: string;
  submittedAt: Date;
  riskLevel: RiskLevel;
  status: CaseStatus;
  version: number;
  updatedAt: Date;
};

function toSummary(row: SummaryRow): CaseSummary {
  return {
    id: row.id,
    customerName: row.customerName,
    submittedAt: row.submittedAt.toISOString(),
    riskLevel: row.riskLevel,
    status: row.status,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCases(db: PrismaClient, filters: CaseListFilters): Promise<CaseSummary[]> {
  const rows = await db.kycCase.findMany({
    where: {
      ...(filters.status === "ALL" ? {} : { status: filters.status }),
      ...(filters.risk ? { riskLevel: filters.risk } : {}),
      ...(filters.q
        ? { OR: [{ id: { contains: filters.q } }, { customerName: { contains: filters.q } }] }
        : {}),
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: summarySelect,
  });
  return rows.map(toSummary);
}

export const detailInclude = Prisma.validator<Prisma.KycCaseInclude>()({
  events: {
    orderBy: [{ createdAt: "asc" }, { newVersion: "asc" }],
    select: {
      id: true,
      type: true,
      previousStatus: true,
      newStatus: true,
      previousVersion: true,
      newVersion: true,
      reason: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
  },
});

type DetailRow = Prisma.KycCaseGetPayload<{ include: typeof detailInclude }>;

export function toDetail(row: DetailRow): CaseDetail {
  const history: DecisionEvent[] = row.events.map((e) => ({
    id: e.id,
    type: e.type,
    actor: e.actor,
    previousStatus: e.previousStatus,
    newStatus: e.newStatus,
    previousVersion: e.previousVersion,
    newVersion: e.newVersion,
    reason: e.reason,
    createdAt: e.createdAt.toISOString(),
  }));
  return { ...toSummary(row), evidence: parseEvidence(row.evidence), history };
}

export async function getCaseDetail(db: PrismaClient, id: string): Promise<CaseDetail | null> {
  const row = await db.kycCase.findUnique({ where: { id }, include: detailInclude });
  return row ? toDetail(row) : null;
}
