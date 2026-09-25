import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { decideCase, type DecisionDb } from "@/lib/kyc/decision-service";
import { currentUserFor, resetAndSeed, snapshotCase } from "./helpers";

const REASON = "Service-level decision with a sufficiently long reason.";

/**
 * Test-only failure injection: the real transaction client is wrapped so that
 * `auditEvent.create` throws after the case UPDATE has executed. No application
 * code path can trigger this.
 */
function withFailingAuditCreate(tx: Prisma.TransactionClient): Prisma.TransactionClient {
  const auditEvent = new Proxy(tx.auditEvent, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return async () => {
          throw new Error("injected audit insertion failure");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return new Proxy(tx, {
    get(target, prop, receiver) {
      return prop === "auditEvent" ? auditEvent : Reflect.get(target, prop, receiver);
    },
  });
}

describe("decision service transaction guarantees", () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it("9. rolls back the case update when audit insertion fails", async () => {
    const alex = await currentUserFor("alex");
    let updateCountInsideTx: number | undefined;
    const failingDb: DecisionDb = {
      $transaction: (fn, options) =>
        prisma.$transaction(async (tx) => {
          const result = await fn(withFailingAuditCreate(tx));
          return result;
        }, options),
    };
    // Prove the UPDATE really ran before the failure by observing it from inside the same transaction.
    const observingDb: DecisionDb = {
      $transaction: (fn, options) =>
        prisma.$transaction(async (tx) => {
          const wrapped = withFailingAuditCreate(tx);
          try {
            return await fn(wrapped);
          } catch (error) {
            updateCountInsideTx = await tx.kycCase.count({ where: { id: "KYC-1007", status: "APPROVED", version: 1 } });
            throw error;
          }
        }, options),
    };

    await expect(decideCase(observingDb, alex, "KYC-1007", { action: "APPROVE", reason: REASON, expectedVersion: 0 })).rejects.toThrow(
      "injected audit insertion failure",
    );
    expect(updateCountInsideTx).toBe(1);

    await expect(decideCase(failingDb, alex, "KYC-1007", { action: "APPROVE", reason: REASON, expectedVersion: 0 })).rejects.toThrow(
      "injected audit insertion failure",
    );

    const snap = await snapshotCase("KYC-1007");
    expect(snap.status).toBe("PENDING");
    expect(snap.version).toBe(0);
    expect(snap.events).toHaveLength(0);
    expect(await prisma.auditEvent.count()).toBe(6);

    // The untouched client still works afterwards.
    const ok = await decideCase(prisma, alex, "KYC-1007", { action: "APPROVE", reason: REASON, expectedVersion: 0 });
    expect(ok.kind).toBe("OK");
  });

  it("rolls back when the audit unique constraint (caseId, newVersion) is violated", async () => {
    const alex = await currentUserFor("alex");
    // Pre-insert a conflicting event row so the real DB constraint fires inside the transaction.
    await prisma.auditEvent.create({
      data: {
        caseId: "KYC-1007",
        actorId: alex.id,
        type: "DECISION",
        previousStatus: "PENDING",
        newStatus: "ESCALATED",
        previousVersion: 0,
        newVersion: 1,
        reason: "Pre-existing row that collides on (caseId, newVersion).",
      },
    });
    await expect(decideCase(prisma, alex, "KYC-1007", { action: "APPROVE", reason: REASON, expectedVersion: 0 })).rejects.toThrow();
    const snap = await snapshotCase("KYC-1007");
    expect(snap.status).toBe("PENDING");
    expect(snap.version).toBe(0);
    expect(snap.events).toHaveLength(1);
  });

  it("refuses to run for a non-reviewer actor", async () => {
    const taylor = await currentUserFor("taylor");
    await expect(decideCase(prisma, taylor, "KYC-1007", { action: "APPROVE", reason: REASON, expectedVersion: 0 })).rejects.toThrow(
      /REVIEWER/,
    );
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0 });
  });

  it("10. two concurrent decisions for one pending case commit at most one transition and one event", async () => {
    const alex = await currentUserFor("alex");
    const sam = await currentUserFor("sam");

    const results = await Promise.all([
      decideCase(prisma, alex, "KYC-1007", { action: "APPROVE", reason: "Alex approves the case concurrently.", expectedVersion: 0 }),
      decideCase(prisma, sam, "KYC-1007", { action: "REJECT", reason: "Sam rejects the case concurrently.", expectedVersion: 0 }),
    ]);

    const kinds = results.map((r) => r.kind);
    const okCount = kinds.filter((k) => k === "OK").length;
    expect(okCount).toBe(1);
    // The loser is either a business conflict (lost the race) or transient contention; never a second OK.
    expect(kinds.filter((k) => k === "CONFLICT" || k === "RETRYABLE")).toHaveLength(1);

    const snap = await snapshotCase("KYC-1007");
    expect(["APPROVED", "REJECTED"]).toContain(snap.status);
    expect(snap.version).toBe(1);
    expect(snap.events).toHaveLength(1);
    expect(await prisma.auditEvent.count()).toBe(7);

    const winner = results.find((r) => r.kind === "OK");
    if (winner?.kind === "OK") {
      expect(winner.case.status).toBe(snap.status);
      expect(snap.events[0]?.actorId).toBe(winner.event.actor.id);
    }
  });

  it("many concurrent decisions across attempts still yield exactly one transition per case", async () => {
    const alex = await currentUserFor("alex");
    const sam = await currentUserFor("sam");
    const attempts = Array.from({ length: 6 }, (_, i) =>
      decideCase(i % 2 === 0 ? prisma : prisma, i % 2 === 0 ? alex : sam, "KYC-1010", {
        action: i % 3 === 0 ? "APPROVE" : i % 3 === 1 ? "REJECT" : "ESCALATE",
        reason: `Concurrent attempt number ${i} with a long enough reason.`,
        expectedVersion: 0,
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.kind === "OK")).toHaveLength(1);
    expect(results.every((r) => r.kind === "OK" || r.kind === "CONFLICT" || r.kind === "RETRYABLE")).toBe(true);
    const snap = await snapshotCase("KYC-1010");
    expect(snap.version).toBe(1);
    expect(snap.events).toHaveLength(1);
  });
});
