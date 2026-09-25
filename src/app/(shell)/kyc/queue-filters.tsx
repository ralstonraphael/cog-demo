import Link from "next/link";
import { RISK_LABELS, STATUS_LABELS } from "@/lib/kyc/labels";
import { filtersToQuery } from "@/lib/kyc/filters-url";
import { type CaseListFilters, SEARCH_MAX_LENGTH } from "@/lib/kyc/queries";

const STATUS_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "ESCALATED", "ALL"] as const;
const RISK_OPTIONS = ["LOW", "MEDIUM", "HIGH"] as const;

/**
 * Plain GET form: filters live in the URL, so browser navigation and the
 * back-to-queue link keep the reviewer's context without client state. The
 * form is keyed by the canonical query so uncontrolled inputs remount (and
 * show the URL's values) on client-side navigation such as Back.
 */
export function QueueFilters({ filters }: { filters: CaseListFilters }) {
  return (
    <form
      key={filtersToQuery(filters)}
      method="get"
      action="/kyc"
      className="card filters"
      role="search"
      aria-label="Filter cases"
    >
      <div className="field">
        <label htmlFor="q">Search</label>
        <input
          id="q"
          name="q"
          type="search"
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Case ID or customer name"
          defaultValue={filters.q ?? ""}
        />
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={filters.status}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="risk">Risk</label>
        <select id="risk" name="risk" defaultValue={filters.risk ?? ""}>
          <option value="">Any risk</option>
          {RISK_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {RISK_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-actions">
        <button className="btn btn-primary" type="submit">
          Apply
        </button>
        <Link className="btn" href="/kyc">
          Clear filters
        </Link>
      </div>
    </form>
  );
}
