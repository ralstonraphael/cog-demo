import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  const user = await getCurrentUser();
  redirect(user ? "/app" : "/sign-in");
}
