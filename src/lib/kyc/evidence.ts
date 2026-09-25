import { z } from "zod";

/**
 * Structured synthetic identity-check evidence. These are simulated provider
 * labels only; no identity documents or government identifiers are stored.
 */
export const checkResultSchema = z.enum(["MATCH", "MISMATCH", "MANUAL_REVIEW", "NOT_AVAILABLE"]);
export type CheckResult = z.infer<typeof checkResultSchema>;

export const evidenceSchema = z.object({
  documentCheck: checkResultSchema,
  nameConsistency: checkResultSchema,
  addressCheck: checkResultSchema,
  providerReference: z.string(),
  summary: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export function parseEvidence(raw: string): Evidence {
  return evidenceSchema.parse(JSON.parse(raw));
}

export function serializeEvidence(evidence: Evidence): string {
  return JSON.stringify(evidence);
}
