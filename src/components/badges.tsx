import type { CaseStatus, RiskLevel } from "@prisma/client";
import type { CheckResult } from "@/lib/kyc/evidence";
import { CHECK_RESULT_LABELS, RISK_LABELS, STATUS_LABELS } from "@/lib/kyc/labels";

/** Status is conveyed by text; the class only adds a supporting colour. */
export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`badge risk-${level.toLowerCase()}`}>{RISK_LABELS[level]}</span>;
}

export function CheckBadge({ result }: { result: CheckResult }) {
  return <span className={`badge check-${result.toLowerCase()}`}>{CHECK_RESULT_LABELS[result]}</span>;
}
