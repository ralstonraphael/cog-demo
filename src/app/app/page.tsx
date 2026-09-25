import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy shell entry point from the foundation milestone; the queue lives at /kyc. */
export default function AppHomePage() {
  redirect("/kyc");
}
