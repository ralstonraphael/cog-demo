import { beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { ACCOUNTS, listCases, resetAndSeed, signIn } from "./helpers";

describe("inactive user sessions", () => {
  beforeAll(async () => {
    await resetAndSeed();
  });

  it("revokes existing sessions once the user is deactivated (audit finding C1)", async () => {
    const cookie = await signIn("sam");
    const headers = new Headers({ cookie });
    expect((await getCurrentUser(headers))?.email).toBe(ACCOUNTS.sam.email);
    expect(await auth.api.getSession({ headers })).not.toBeNull();

    await prisma.user.update({ where: { email: ACCOUNTS.sam.email }, data: { active: false } });

    expect(await getCurrentUser(headers)).toBeNull();
    expect((await listCases("", { cookie })).status).toBe(401);
    // The library's own session endpoint must no longer serve the revoked session either.
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await prisma.session.count({ where: { user: { email: ACCOUNTS.sam.email } } })).toBe(0);

    await prisma.user.update({ where: { email: ACCOUNTS.sam.email }, data: { active: true } });
  });
});
