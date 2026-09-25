import { requireUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  const user = await requireUser();

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Welcome, {user.name}</h2>
      <p className="muted">
        You are signed in as <strong>{user.role}</strong>.{" "}
        {user.role === "REVIEWER"
          ? "You can review pending KYC cases and record decisions."
          : "You can read KYC cases and their decision history."}
      </p>
      <p className="muted">The case queue will appear here in the next milestone.</p>
    </div>
  );
}
