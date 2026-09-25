import Link from "next/link";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { LocalTime } from "@/components/local-time";
import { requireUserOrRedirect } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { filtersToQuery, type SearchParams, toURLSearchParams } from "@/lib/kyc/filters-url";
import { listCases, parseCaseListFilters, SEARCH_MAX_LENGTH } from "@/lib/kyc/queries";
import { QueueFilters } from "./queue-filters";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<SearchParams> };

export default async function QueuePage({ searchParams }: Props) {
  const params = toURLSearchParams(await searchParams);
  const user = await requireUserOrRedirect(`/kyc${params.size ? `?${params}` : ""}`);

  const filters = parseCaseListFilters(params);
  if (!filters) {
    return (
      <section className="card" aria-labelledby="queue-error-title">
        <h2 id="queue-error-title">These filters are not valid</h2>
        <p className="muted">
          The status or risk value in the address bar is not recognised, or the search text is longer than{" "}
          {SEARCH_MAX_LENGTH} characters.
        </p>
        <Link className="btn" href="/kyc">
          Clear filters
        </Link>
      </section>
    );
  }

  const cases = await listCases(prisma, filters);
  const query = filtersToQuery(filters);
  const hasActiveFilters = query.length > 0;
  const detailQuery = query ? `?${query}` : "";

  return (
    <>
      <div className="page-header">
        <div>
          <h2>KYC review queue</h2>
          <p className="muted">
            {user.role === "REVIEWER"
              ? "Open a pending case to review its synthetic check results and record a decision."
              : "Read-only access: you can inspect cases and history but cannot record decisions."}
          </p>
        </div>
      </div>

      <QueueFilters filters={filters} />

      <section className="card table-card" aria-labelledby="results-title">
        <div className="results-bar">
          <h3 id="results-title">
            {cases.length} {cases.length === 1 ? "case" : "cases"}
          </h3>
          <span className="muted">Oldest submission first</span>
        </div>

        {cases.length === 0 ? (
          <div className="empty-state">
            <p>No cases match these filters.</p>
            {hasActiveFilters ? (
              <Link className="btn" href="/kyc">
                Clear filters
              </Link>
            ) : (
              <p className="muted">There are no pending cases right now.</p>
            )}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Customer</th>
                <th scope="col">Submitted</th>
                <th scope="col">Risk</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/kyc/${c.id}${detailQuery}`} className="case-link">
                      {c.id}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/kyc/${c.id}${detailQuery}`} className="customer-link">
                      {c.customerName}
                    </Link>
                  </td>
                  <td>
                    <LocalTime iso={c.submittedAt} showAge />
                  </td>
                  <td>
                    <RiskBadge level={c.riskLevel} />
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
