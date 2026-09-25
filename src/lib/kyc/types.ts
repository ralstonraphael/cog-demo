import type { CaseStatus, RiskLevel } from "@prisma/client";
import type { Evidence } from "@/lib/kyc/evidence";

/** Row shape returned by GET /api/kyc-cases (queue view). */
export type CaseSummary = {
  id: string;
  customerName: string;
  submittedAt: string; // ISO-8601 UTC
  riskLevel: RiskLevel;
  status: CaseStatus;
  version: number;
  updatedAt: string;
};

export type DecisionEvent = {
  id: string;
  type: "CASE_CREATED" | "DECISION";
  actor: { id: string; name: string };
  previousStatus: CaseStatus;
  newStatus: CaseStatus;
  previousVersion: number;
  newVersion: number;
  reason: string;
  createdAt: string;
};

/** Shape returned by GET /api/kyc-cases/:id and in decision responses. */
export type CaseDetail = CaseSummary & {
  evidence: Evidence;
  history: DecisionEvent[];
};

export const DECISION_ACTIONS = ["APPROVE", "REJECT", "ESCALATE"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const ACTION_TO_STATUS: Record<DecisionAction, Exclude<CaseStatus, "PENDING">> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  ESCALATE: "ESCALATED",
};

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 500;
