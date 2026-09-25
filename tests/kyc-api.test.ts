import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCase, listCases, postDecision, resetAndSeed, signIn, snapshotCase } from "./helpers";

const VALID_REASON = "Reviewed evidence; name mismatch explained by documented change.";

let alex: string;
let taylor: string;

beforeAll(async () => {
  await resetAndSeed();
  alex = await signIn("alex");
  taylor = await signIn("taylor");
});

describe("read endpoints", () => {
  it("1. rejects anonymous list and detail requests", async () => {
    expect((await listCases("", { cookie: undefined })).status).toBe(401);
    expect((await getCase("KYC-1007", { cookie: undefined })).status).toBe(401);
    const garbage = await getCase("KYC-1007", { cookie: "better-auth.session_token=not-a-real-token" });
    expect(garbage.status).toBe(401);
  });

  it("rejects a session that has been signed out", async () => {
    const sam = await signIn("sam");
    expect((await listCases("", { cookie: sam })).status).toBe(200);
    const token = sam.split("=")[1]?.split(".")[0];
    await prisma.session.deleteMany({ where: { token } });
    expect((await listCases("", { cookie: sam })).status).toBe(401);
  });

  it("2. a viewer can read the queue and case detail", async () => {
    const list = await listCases("", { cookie: taylor });
    expect(list.status).toBe(200);
    expect(list.json.filters.status).toBe("PENDING");
    expect(list.json.cases).toHaveLength(14);
    expect(list.json.cases.every((c: { status: string }) => c.status === "PENDING")).toBe(true);
    const first = list.json.cases[0];
    expect(Object.keys(first).sort()).toEqual(
      ["customerName", "id", "riskLevel", "status", "submittedAt", "updatedAt", "version"].sort(),
    );

    const detail = await getCase("KYC-1007", { cookie: taylor });
    expect(detail.status).toBe(200);
    expect(detail.json.case).toMatchObject({
      id: "KYC-1007",
      customerName: "Morgan Ellis",
      riskLevel: "MEDIUM",
      status: "PENDING",
      version: 0,
      evidence: { documentCheck: "MANUAL_REVIEW", nameConsistency: "MISMATCH", addressCheck: "MATCH", providerReference: "SIM-KYC-1007" },
      history: [],
    });
    const serialized = JSON.stringify(detail.json);
    expect(serialized).not.toMatch(/password|session|email/i);
  });

  it("filters, searches, sorts and validates", async () => {
    const all = await listCases("?status=ALL", { cookie: alex });
    expect(all.json.cases).toHaveLength(20);
    const ids = all.json.cases.map((c: { id: string }) => c.id);
    expect(ids[0]).toBe("KYC-1001");
    expect(ids[19]).toBe("KYC-1020");

    expect((await listCases("?status=APPROVED", { cookie: alex })).json.cases).toHaveLength(2);
    expect((await listCases("?status=ALL&risk=HIGH", { cookie: alex })).json.cases).toHaveLength(6);
    expect((await listCases("?q=morgan", { cookie: alex })).json.cases.map((c: { id: string }) => c.id)).toEqual(["KYC-1007"]);
    expect((await listCases("?q=KYC-1001", { cookie: alex })).json.cases).toHaveLength(0); // approved, default PENDING filter
    expect((await listCases("?q=KYC-1001&status=ALL", { cookie: alex })).json.cases).toHaveLength(1);
    expect((await listCases("?q=zzz-no-match", { cookie: alex })).json.cases).toHaveLength(0);

    expect((await listCases("?status=BOGUS", { cookie: alex })).status).toBe(400);
    expect((await listCases("?risk=EXTREME", { cookie: alex })).status).toBe(400);
    expect((await listCases(`?q=${"a".repeat(61)}`, { cookie: alex })).status).toBe(400);
  });

  it("includes actor names in ordered history and returns 404 for unknown ids", async () => {
    const detail = await getCase("KYC-1001", { cookie: taylor });
    expect(detail.json.case.status).toBe("APPROVED");
    expect(detail.json.case.version).toBe(1);
    expect(detail.json.case.history).toHaveLength(1);
    expect(detail.json.case.history[0]).toMatchObject({
      type: "DECISION",
      previousStatus: "PENDING",
      newStatus: "APPROVED",
      previousVersion: 0,
      newVersion: 1,
      actor: { name: "Alex Reviewer" },
    });
    expect((await getCase("KYC-9999", { cookie: taylor })).status).toBe(404);
    expect((await getCase("../etc", { cookie: taylor })).status).toBe(404);
  });
});

describe("decision endpoint", () => {
  beforeEach(async () => {
    await resetAndSeed();
    alex = await signIn("alex");
    taylor = await signIn("taylor");
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    action: "APPROVE",
    reason: VALID_REASON,
    expectedVersion: 0,
    ...overrides,
  });

  it("1b. anonymous decision requests are rejected with 401", async () => {
    const res = await postDecision("KYC-1007", { body: body() });
    expect(res.status).toBe(401);
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("2b. a viewer's direct decision request returns 403 and writes nothing", async () => {
    const res = await postDecision("KYC-1007", { cookie: taylor, body: body() });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("3. client-supplied identity or role fields cannot authorize a mutation", async () => {
    const alexUser = await prisma.user.findUniqueOrThrow({ where: { email: "alex@demo.test" } });
    // Viewer claims to be a reviewer in body and headers.
    const asViewer = await postDecision("KYC-1007", {
      cookie: taylor,
      body: body({ actorId: alexUser.id, role: "REVIEWER" }),
      extraHeaders: { "x-user-role": "REVIEWER", "x-user-id": alexUser.id },
    });
    expect(asViewer.status).toBe(403);
    // Reviewer supplying identity fields is rejected as an invalid body (unknown fields).
    const asReviewer = await postDecision("KYC-1007", { cookie: alex, body: body({ actorId: "usr_sam", role: "REVIEWER" }) });
    expect(asReviewer.status).toBe(400);
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("rejects cookie-authenticated requests from a foreign or missing origin", async () => {
    expect((await postDecision("KYC-1007", { cookie: alex, body: body(), origin: "http://evil.example" })).status).toBe(403);
    expect((await postDecision("KYC-1007", { cookie: alex, body: body(), origin: null })).status).toBe(403);
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("4. a valid reviewer decision changes status, increments version, and records one event", async () => {
    const res = await postDecision("KYC-1007", { cookie: alex, body: body({ action: "REJECT", reason: `  ${VALID_REASON}  ` }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.json.case).toMatchObject({ id: "KYC-1007", status: "REJECTED", version: 1 });
    expect(res.json.case.history).toHaveLength(1);
    expect(res.json.event).toMatchObject({
      type: "DECISION",
      previousStatus: "PENDING",
      newStatus: "REJECTED",
      previousVersion: 0,
      newVersion: 1,
      reason: VALID_REASON,
      actor: { name: "Alex Reviewer" },
    });
    expect(JSON.stringify(res.json)).not.toMatch(/password|session_token|@demo\.test/i);

    const snap = await snapshotCase("KYC-1007");
    const alexUser = await prisma.user.findUniqueOrThrow({ where: { email: "alex@demo.test" } });
    expect(snap.status).toBe("REJECTED");
    expect(snap.version).toBe(1);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({ actorId: alexUser.id, reason: VALID_REASON, newVersion: 1, newStatus: "REJECTED" });
    expect(await prisma.auditEvent.count()).toBe(7);
  });

  it("maps ESCALATE -> ESCALATED and APPROVE -> APPROVED", async () => {
    const esc = await postDecision("KYC-1008", { cookie: alex, body: body({ action: "ESCALATE" }) });
    expect(esc.status).toBe(200);
    expect(esc.json.case.status).toBe("ESCALATED");
    const app = await postDecision("KYC-1009", { cookie: alex, body: body({ action: "APPROVE" }) });
    expect(app.status).toBe(200);
    expect(app.json.case.status).toBe("APPROVED");
  });

  it("5. invalid bodies produce 400 and no writes", async () => {
    const cases: Array<Record<string, unknown> | string> = [
      body({ action: "DELETE" }),
      body({ action: "APPROVED" }),
      body({ action: "approve" }),
      body({ reason: "" }),
      body({ reason: "   too short   " }),
      body({ reason: "x".repeat(501) }),
      body({ expectedVersion: -1 }),
      body({ expectedVersion: 1.5 }),
      body({ expectedVersion: "0" }),
      body({ status: "APPROVED" }),
      body({ timestamp: new Date().toISOString() }),
      body({ actorId: "usr_sam" }),
      { reason: VALID_REASON, expectedVersion: 0 },
      "not json at all",
      "[]",
      "null",
    ];
    for (const payload of cases) {
      const res =
        typeof payload === "string"
          ? await postDecision("KYC-1007", { cookie: alex, rawBody: payload })
          : await postDecision("KYC-1007", { cookie: alex, body: payload });
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.json.error.code).toBe("INVALID_DECISION");
    }
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
    expect(await prisma.auditEvent.count()).toBe(6);
  });

  it("6. a repeated request with the old version returns 409 and creates no new event", async () => {
    const first = await postDecision("KYC-1007", { cookie: alex, body: body() });
    expect(first.status).toBe(200);
    const replay = await postDecision("KYC-1007", { cookie: alex, body: body() });
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe("CASE_NOT_PENDING");
    expect(replay.json.error.currentVersion).toBe(1);
    const snap = await snapshotCase("KYC-1007");
    expect(snap.events).toHaveLength(1);
    expect(snap.version).toBe(1);
  });

  it("7. a different decision with a stale version cannot overwrite the winner", async () => {
    const sam = await signIn("sam");
    const winner = await postDecision("KYC-1007", { cookie: alex, body: body({ action: "APPROVE" }) });
    expect(winner.status).toBe(200);
    const loser = await postDecision("KYC-1007", { cookie: sam, body: body({ action: "REJECT", reason: "Stale decision that must not win the race." }) });
    expect(loser.status).toBe(409);
    const snap = await snapshotCase("KYC-1007");
    expect(snap.status).toBe("APPROVED");
    expect(snap.version).toBe(1);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]?.newStatus).toBe("APPROVED");
  });

  it("returns 409 VERSION_CONFLICT for a pending case when expectedVersion is wrong", async () => {
    const res = await postDecision("KYC-1007", { cookie: alex, body: body({ expectedVersion: 3 }) });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("VERSION_CONFLICT");
    expect(res.json.error.currentVersion).toBe(0);
    expect(await snapshotCase("KYC-1007")).toMatchObject({ status: "PENDING", version: 0, events: [] });
  });

  it("8. APPROVED, REJECTED and ESCALATED cases cannot transition again", async () => {
    for (const [id, status] of [["KYC-1001", "APPROVED"], ["KYC-1002", "REJECTED"], ["KYC-1003", "ESCALATED"]] as const) {
      for (const action of ["APPROVE", "REJECT", "ESCALATE"] as const) {
        const res = await postDecision(id, { cookie: alex, body: body({ action, expectedVersion: 1 }) });
        expect(res.status, `${id} ${action}`).toBe(409);
        expect(res.json.error.code).toBe("CASE_NOT_PENDING");
      }
      const snap = await snapshotCase(id);
      expect(snap.status).toBe(status);
      expect(snap.version).toBe(1);
      expect(snap.events).toHaveLength(1);
    }
    expect(await prisma.auditEvent.count()).toBe(6);
  });

  it("returns 404 for an unknown case after access checks", async () => {
    expect((await postDecision("KYC-4242", { cookie: alex, body: body() })).status).toBe(404);
    expect((await postDecision("KYC-4242", { cookie: taylor, body: body() })).status).toBe(403);
    expect((await postDecision("KYC-4242", { body: body() })).status).toBe(401);
  });
});
