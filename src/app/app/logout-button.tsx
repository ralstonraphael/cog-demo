"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button className="btn" type="button" onClick={onClick} disabled={busy}>
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
