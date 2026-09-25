import type { CaseStatus, RiskLevel } from "@prisma/client";
import type { CheckResult } from "@/lib/kyc/evidence";
import type { DecisionAction } from "@/lib/kyc/types";

export const STATUS_LABELS: Record<CaseStatus, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ESCALATED: "Awaiting supervisor review",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
};

export const ACTION_LABELS: Record<DecisionAction, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  ESCALATE: "Escalate",
};

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  MANUAL_REVIEW: "Manual review",
  NOT_AVAILABLE: "Not available",
};

/** Short, reviewer-facing meaning of each synthetic check result. */
export const CHECK_RESULT_HINTS: Record<CheckResult, string> = {
  MATCH: "Simulated provider reported agreement with the application.",
  MISMATCH: "Simulated provider reported a discrepancy; weigh against other checks.",
  MANUAL_REVIEW: "Simulated provider could not decide automatically; human judgement required.",
  NOT_AVAILABLE: "No simulated result was returned for this check.",
};

export const EVIDENCE_FIELDS = [
  { key: "documentCheck", label: "Document check" },
  { key: "nameConsistency", label: "Name consistency" },
  { key: "addressCheck", label: "Address check" },
] as const;
