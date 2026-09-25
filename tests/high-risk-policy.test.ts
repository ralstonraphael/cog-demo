import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { postDecision, resetAndSeed, signIn, snapshotCase } from "./helpers";

const REASON = "Reviewed synthetic evidence for the high-risk policy test.";
const body = (overrides: Record<string, unknown> = {}) => ({ action: "APPROVE", reason: REASON, expectedVersion: 0, ...overrides });

let alex: string;
let taylor: string;

beforeAll(async () => {
  await resetAndSeed();
  alex = await signIn("alex");
  taylor = await signIn("taylor");
});

describe("demonstration policy: HIGH-risk cases cannot be approved directly", () => {
  it("direct APPROVE of a pending HIGH case returns 422 and writes nothing", async () => {
    const before = await snapshotCase("KYC-1009");
    expect(before).toMatchObject({ status: "PENDING", version: 0 });
    const eventsBefore = await prisma.auditEvent.count();

    const res = await postDecision("KYC-1009", { cookie: alex, body: body() });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("HIGH_RISK_REQUIRES_ESCALATION");
    expect(res.json.error.message).toMatch(/require escalation for approval/);

    expect(await snapshotCase("KYC-1009")).toMatchObject({ status: "PENDING", version: 0, events: [] });
    expect(await prisma.auditEvent.count()).toBe(eventsBefore);
  });

  it("policy is based on the persisted risk level, not client input", async () => {
    const res = await postDecision("KYC-1009", { cookie: alex, body: body({ riskLevel: "LOW" }) });
    expect(res.status).toBe(400);
    expect(await snapshotCase("KYC-1009")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("REJECT of a pending HIGH case still works", async () => {
    const res = await postDecision("KYC-1009", { cookie: alex, body: body({ action: "REJECT" }) });
    expect(res.status).toBe(200);
    expect(res.json.case).toMatchObject({ id: "KYC-1009", riskLevel: "HIGH", status: "REJECTED", version: 1 });
    expect(res.json.case.history).toHaveLength(1);
    expect(res.json.event).toMatchObject({ newStatus: "REJECTED", reason: REASON, actor: { name: "Alex Reviewer" } });
    const snap = await snapshotCase("KYC-1009");
    expect(snap.events).toHaveLength(1);
  });

  it("ESCALATE of a pending HIGH case still works", async () => {
    const res = await postDecision("KYC-1012", { cookie: alex, body: body({ action: "ESCALATE" }) });
    expect(res.status).toBe(200);
    expect(res.json.case).toMatchObject({ id: "KYC-1012", riskLevel: "HIGH", status: "ESCALATED", version: 1 });
    expect((await snapshotCase("KYC-1012")).events).toHaveLength(1);
  });

  it("a decided HIGH case reports 409 (not 422) for a late APPROVE", async () => {
    const res = await postDecision("KYC-1009", { cookie: alex, body: body() });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("CASE_NOT_PENDING");
    expect((await snapshotCase("KYC-1009")).events).toHaveLength(1);
  });

  it("APPROVE of LOW and MEDIUM cases is unchanged", async () => {
    const low = await postDecision("KYC-1008", { cookie: alex, body: body() });
    expect(low.status).toBe(200);
    expect(low.json.case).toMatchObject({ riskLevel: "LOW", status: "APPROVED", version: 1 });

    const medium = await postDecision("KYC-1007", { cookie: alex, body: body() });
    expect(medium.status).toBe(200);
    expect(medium.json.case).toMatchObject({ riskLevel: "MEDIUM", status: "APPROVED", version: 1 });
  });

  it("viewer restrictions are unchanged for HIGH cases", async () => {
    for (const action of ["APPROVE", "REJECT", "ESCALATE"]) {
      const res = await postDecision("KYC-1015", { cookie: taylor, body: body({ action }) });
      expect(res.status, action).toBe(403);
    }
    expect(await snapshotCase("KYC-1015")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });
});
