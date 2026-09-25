import type { CaseStatus, RiskLevel, Role } from "@prisma/client";
import type { Evidence } from "../src/lib/kyc/evidence";

export type UserFixture = {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordEnv: string;
};

export const USER_FIXTURES: readonly UserFixture[] = [
  { id: "usr_alex", name: "Alex Reviewer", email: "alex@demo.test", role: "REVIEWER", passwordEnv: "SEED_PASSWORD_ALEX" },
  { id: "usr_sam", name: "Sam Reviewer", email: "sam@demo.test", role: "REVIEWER", passwordEnv: "SEED_PASSWORD_SAM" },
  { id: "usr_taylor", name: "Taylor Viewer", email: "taylor@demo.test", role: "VIEWER", passwordEnv: "SEED_PASSWORD_TAYLOR" },
];

export type CaseFixture = {
  id: string;
  customerName: string;
  submittedAt: string; // ISO-8601 UTC
  riskLevel: RiskLevel;
  evidence: Evidence;
  status: CaseStatus;
  /** Historical decision, present only for non-PENDING fixtures. */
  decision?: { actorId: string; reason: string; decidedAt: string };
};

const BASE = Date.UTC(2026, 8, 1, 9, 0, 0); // 2026-09-01T09:00:00Z
const at = (hoursOffset: number) => new Date(BASE + hoursOffset * 60 * 60 * 1000).toISOString();

const ev = (
  documentCheck: Evidence["documentCheck"],
  nameConsistency: Evidence["nameConsistency"],
  addressCheck: Evidence["addressCheck"],
  id: string,
  summary: string,
): Evidence => ({ documentCheck, nameConsistency, addressCheck, providerReference: `SIM-${id}`, summary });

// 20 deterministic synthetic cases: 14 PENDING, 2 APPROVED, 2 REJECTED, 2 ESCALATED.
export const CASE_FIXTURES: readonly CaseFixture[] = [
  // --- previously decided (version 1) ---
  {
    id: "KYC-1001",
    customerName: "Riley Chen",
    submittedAt: at(0),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "MATCH", "KYC-1001", "All simulated checks matched."),
    status: "APPROVED",
    decision: { actorId: "usr_alex", reason: "All checks matched; low risk profile.", decidedAt: at(3) },
  },
  {
    id: "KYC-1002",
    customerName: "Jordan Patel",
    submittedAt: at(2),
    riskLevel: "HIGH",
    evidence: ev("MISMATCH", "MISMATCH", "MISMATCH", "KYC-1002", "Multiple simulated checks failed."),
    status: "REJECTED",
    decision: { actorId: "usr_sam", reason: "Document, name and address checks all failed.", decidedAt: at(5) },
  },
  {
    id: "KYC-1003",
    customerName: "Casey Nguyen",
    submittedAt: at(4),
    riskLevel: "HIGH",
    evidence: ev("MANUAL_REVIEW", "MATCH", "NOT_AVAILABLE", "KYC-1003", "Address data unavailable; high-risk segment."),
    status: "ESCALATED",
    decision: { actorId: "usr_alex", reason: "High risk with missing address evidence; needs supervisor review.", decidedAt: at(7) },
  },
  {
    id: "KYC-1004",
    customerName: "Avery Brooks",
    submittedAt: at(6),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "MATCH", "KYC-1004", "All simulated checks matched."),
    status: "APPROVED",
    decision: { actorId: "usr_sam", reason: "Clean result set, low risk; approved.", decidedAt: at(8) },
  },
  {
    id: "KYC-1005",
    customerName: "Quinn Okafor",
    submittedAt: at(9),
    riskLevel: "MEDIUM",
    evidence: ev("MISMATCH", "MATCH", "MATCH", "KYC-1005", "Simulated document check failed."),
    status: "REJECTED",
    decision: { actorId: "usr_alex", reason: "Document check failed and could not be reconciled.", decidedAt: at(12) },
  },
  {
    id: "KYC-1006",
    customerName: "Drew Castillo",
    submittedAt: at(11),
    riskLevel: "MEDIUM",
    evidence: ev("MANUAL_REVIEW", "MANUAL_REVIEW", "MATCH", "KYC-1006", "Two checks flagged for manual review."),
    status: "ESCALATED",
    decision: { actorId: "usr_sam", reason: "Two manual-review flags; escalating for supervisor decision.", decidedAt: at(14) },
  },
  // --- pending (version 0) ---
  {
    id: "KYC-1007",
    customerName: "Morgan Ellis",
    submittedAt: at(13),
    riskLevel: "MEDIUM",
    evidence: ev(
      "MANUAL_REVIEW",
      "MISMATCH",
      "MATCH",
      "KYC-1007",
      "Name on the simulated document does not match the application; requires human review.",
    ),
    status: "PENDING",
  },
  {
    id: "KYC-1008",
    customerName: "Harper Singh",
    submittedAt: at(15),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "MATCH", "KYC-1008", "All simulated checks matched."),
    status: "PENDING",
  },
  {
    id: "KYC-1009",
    customerName: "Rowan Fischer",
    submittedAt: at(17),
    riskLevel: "HIGH",
    evidence: ev("MISMATCH", "MATCH", "MISMATCH", "KYC-1009", "Document and address checks failed."),
    status: "PENDING",
  },
  {
    id: "KYC-1010",
    customerName: "Skyler Moreau",
    submittedAt: at(19),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "NOT_AVAILABLE", "KYC-1010", "Address check unavailable from simulated provider."),
    status: "PENDING",
  },
  {
    id: "KYC-1011",
    customerName: "Emerson Walsh",
    submittedAt: at(21),
    riskLevel: "MEDIUM",
    evidence: ev("MATCH", "MANUAL_REVIEW", "MATCH", "KYC-1011", "Name spelling variant flagged for review."),
    status: "PENDING",
  },
  {
    id: "KYC-1012",
    customerName: "Reese Adeyemi",
    submittedAt: at(23),
    riskLevel: "HIGH",
    evidence: ev("MANUAL_REVIEW", "MISMATCH", "MISMATCH", "KYC-1012", "Name and address mismatches; document flagged."),
    status: "PENDING",
  },
  {
    id: "KYC-1013",
    customerName: "Finley Dubois",
    submittedAt: at(25),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "MATCH", "KYC-1013", "All simulated checks matched."),
    status: "PENDING",
  },
  {
    id: "KYC-1014",
    customerName: "Parker Lindqvist",
    submittedAt: at(27),
    riskLevel: "MEDIUM",
    evidence: ev("MATCH", "MATCH", "MISMATCH", "KYC-1014", "Address on file differs from simulated provider record."),
    status: "PENDING",
  },
  {
    id: "KYC-1015",
    customerName: "Sawyer Ibrahim",
    submittedAt: at(29),
    riskLevel: "HIGH",
    evidence: ev("MISMATCH", "MISMATCH", "MATCH", "KYC-1015", "Document and name checks failed."),
    status: "PENDING",
  },
  {
    id: "KYC-1016",
    customerName: "Blake Romero",
    submittedAt: at(31),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MANUAL_REVIEW", "MATCH", "KYC-1016", "Minor name formatting difference flagged."),
    status: "PENDING",
  },
  {
    id: "KYC-1017",
    customerName: "Dakota Hayashi",
    submittedAt: at(33),
    riskLevel: "MEDIUM",
    evidence: ev("MANUAL_REVIEW", "MATCH", "MANUAL_REVIEW", "KYC-1017", "Document and address flagged for manual review."),
    status: "PENDING",
  },
  {
    id: "KYC-1018",
    customerName: "Hayden Kowalski",
    submittedAt: at(35),
    riskLevel: "HIGH",
    evidence: ev("NOT_AVAILABLE", "NOT_AVAILABLE", "NOT_AVAILABLE", "KYC-1018", "Simulated provider returned no results."),
    status: "PENDING",
  },
  {
    id: "KYC-1019",
    customerName: "Jamie Oyelaran",
    submittedAt: at(37),
    riskLevel: "LOW",
    evidence: ev("MATCH", "MATCH", "MATCH", "KYC-1019", "All simulated checks matched."),
    status: "PENDING",
  },
  {
    id: "KYC-1020",
    customerName: "Kendall Varga",
    submittedAt: at(39),
    riskLevel: "MEDIUM",
    evidence: ev("MATCH", "MISMATCH", "MATCH", "KYC-1020", "Name mismatch against simulated document."),
    status: "PENDING",
  },
];
