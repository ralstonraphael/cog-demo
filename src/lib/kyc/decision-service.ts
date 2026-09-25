import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { CurrentUser } from "@/lib/auth/current-user";
import { detailInclude, toDetail } from "@/lib/kyc/queries";
import {
  ACTION_TO_STATUS,
  DECISION_ACTIONS,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  type CaseDetail,
  type DecisionEvent,
} from "@/lib/kyc/types";

/**
 * Strict request contract for POST /api/kyc-cases/:id/decisions.
 * Unknown fields (actorId, role, status, timestamp, ...) are rejected.
 */
export const decisionInputSchema = z
  .object({
    action: z.enum(DECISION_ACTIONS),
    reason: z.string().trim().min(REASON_MIN_LENGTH).max(REASON_MAX_LENGTH),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export type DecisionInput = z.infer<typeof decisionInputSchema>;

export type DecisionOutcome =
  | { kind: "OK"; case: CaseDetail; event: DecisionEvent }
  | { kind: "NOT_FOUND" }
  | { kind: "CONFLICT"; reason: "NOT_PENDING" | "VERSION_MISMATCH"; currentStatus: string; currentVersion: number }
  | { kind: "RETRYABLE"; message: string };

/** Minimal database surface the service needs (interactive transactions only), so tests can wrap the real client. */
export type DecisionDb = {
  $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
};

class ConflictSignal extends Error {
  constructor() {
    super("conflict");
    this.name = "ConflictSignal";
  }
}

const MAX_ATTEMPTS = 3;
const TRANSACTION_TIMEOUT_MS = 5_000;
const BACKOFF_MS = [25, 75];

/**
 * SQLite reports write contention as "database is locked"/SQLITE_BUSY. Prisma
 * surfaces it as P2034 (write conflict / deadlock), P2024 (pool timeout), P2028
 * (transaction API error) or as an unknown request error carrying the message.
 */
export function isTransientDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.code === "P2024" || error.code === "P2028" || /locked|busy/i.test(error.message);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /locked|busy|SQLITE_BUSY/i.test(error.message);
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies a reviewer decision to a pending case with optimistic concurrency.
 *
 * The status and version guard is part of the UPDATE itself (conditional
 * `updateMany`), the audit event is written in the same transaction, and any
 * failure after the update rolls both back. Transient SQLite contention is
 * retried a bounded number of times with the caller's original
 * `expectedVersion`; the request is never re-based onto a newer version.
 */
export async function decideCase(
  db: DecisionDb,
  actor: CurrentUser,
  caseId: string,
  input: DecisionInput,
): Promise<DecisionOutcome> {
  if (actor.role !== "REVIEWER") {
    throw new Error("decideCase requires a REVIEWER actor; enforce with requireReviewer before calling.");
  }
  const newStatus = ACTION_TO_STATUS[input.action];
  const reason = input.reason.trim();

  let lastTransient: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const updated = await tx.kycCase.updateMany({
            where: { id: caseId, status: "PENDING", version: input.expectedVersion },
            data: { status: newStatus, version: { increment: 1 } },
          });
          if (updated.count !== 1) {
            throw new ConflictSignal();
          }

          const event = await tx.auditEvent.create({
            data: {
              caseId,
              actorId: actor.id,
              type: "DECISION",
              previousStatus: "PENDING",
              newStatus,
              previousVersion: input.expectedVersion,
              newVersion: input.expectedVersion + 1,
              reason,
            },
            select: { id: true },
          });

          const row = await tx.kycCase.findUniqueOrThrow({ where: { id: caseId }, include: detailInclude });
          const detail = toDetail(row);
          const committed = detail.history.find((h) => h.id === event.id);
          if (!committed) throw new Error("Committed audit event missing from history.");
          return { kind: "OK", case: detail, event: committed } satisfies DecisionOutcome;
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof ConflictSignal) {
        return explainConflict(db, caseId);
      }
      if (isTransientDbError(error)) {
        lastTransient = error;
        const backoff = BACKOFF_MS[attempt];
        if (backoff !== undefined) await sleep(backoff);
        continue;
      }
      throw error;
    }
  }
  return {
    kind: "RETRYABLE",
    message: lastTransient instanceof Error ? lastTransient.message : "Database busy; retry the request.",
  };
}

async function explainConflict(db: DecisionDb, caseId: string): Promise<DecisionOutcome> {
  const current = await db.$transaction((tx) =>
    tx.kycCase.findUnique({ where: { id: caseId }, select: { status: true, version: true } }),
  );
  if (!current) return { kind: "NOT_FOUND" };
  return {
    kind: "CONFLICT",
    reason: current.status === "PENDING" ? "VERSION_MISMATCH" : "NOT_PENDING",
    currentStatus: current.status,
    currentVersion: current.version,
  };
}
