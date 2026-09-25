import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/app");

  return (
    <>
      <div className="env-banner">Synthetic demo data — no real customer information.</div>
      <main className="signin">
        <div className="card">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>Operations Workbench</h1>
          <p className="muted">Sign in with a seeded demo account.</p>
          <SignInForm />
        </div>
      </main>
    </>
  );
}
