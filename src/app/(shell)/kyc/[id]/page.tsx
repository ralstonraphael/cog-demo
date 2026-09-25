import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { queueHref, type SearchParams, toURLSearchParams } from "@/lib/kyc/filters-url";
import { CASE_ID_PATTERN, getCaseDetail } from "@/lib/kyc/queries";
import { CaseView } from "./case-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

export default async function CaseDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const query = toURLSearchParams(sp);
  const user = await requireUserOrRedirect(`/kyc/${id}${query.size ? `?${query}` : ""}`);
  const backHref = queueHref(sp);

  const detail = CASE_ID_PATTERN.test(id) ? await getCaseDetail(prisma, id) : null;
  if (!detail) {
    return (
      <section className="card" aria-labelledby="not-found-title">
        <h2 id="not-found-title">Case not found</h2>
        <p className="muted">
          No case with ID <code>{id}</code> exists in the synthetic dataset.
        </p>
        <Link className="btn" href={backHref}>
          Back to queue
        </Link>
      </section>
    );
  }

  return <CaseView initial={detail} canDecide={user.role === "REVIEWER"} backHref={backHref} />;
}
