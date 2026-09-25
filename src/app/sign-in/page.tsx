import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/** Only same-app paths are honoured as post-sign-in destinations. */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/kyc";
  return value;
}

export default async function SignInPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  const user = await getCurrentUser();
  if (user) redirect(next);

  return (
    <>
      <div className="env-banner">Synthetic demo data — no real customer information.</div>
      <main className="signin">
        <div className="card">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>Operations Workbench</h1>
          <p className="muted">Sign in with a seeded demo account.</p>
          <p className="muted demo-accounts">
            Reviewer: <code>alex@demo.test</code> or <code>sam@demo.test</code>
            <br />
            Viewer (read-only): <code>taylor@demo.test</code>
            <br />
            Passwords are the <code>SEED_PASSWORD_*</code> values in your local <code>.env</code>.
          </p>
          <SignInForm next={next} />
        </div>
      </main>
    </>
  );
}
