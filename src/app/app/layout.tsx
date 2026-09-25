import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

/**
 * Authenticated application shell. This layout gates rendering for anonymous
 * users; every page and data path underneath still calls the auth helpers
 * itself, because layouts alone are not a sufficient authorization boundary.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <>
      <div className="env-banner">Synthetic demo data — no real customer information.</div>
      <header className="topbar">
        <h1>Operations Workbench · KYC Review</h1>
        <div className="user-chip">
          <span>{user.name}</span>
          <span className="role-badge">{user.role}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
