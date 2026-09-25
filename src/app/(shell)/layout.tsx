import Link from "next/link";
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
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Operations Workbench</span>
          <nav aria-label="Primary">
            <Link href="/kyc" className="nav-link">
              KYC
            </Link>
          </nav>
        </div>
        <div className="user-chip">
          <span className="env-label" title="All records are synthetic. No real customer information.">
            Synthetic demo data
          </span>
          <span>
            {user.name} <span className="role-badge">{user.role}</span>
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
