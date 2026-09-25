import { type CaseListFilters, parseCaseListFilters } from "@/lib/kyc/queries";

export type SearchParams = Record<string, string | string[] | undefined>;

export function toURLSearchParams(searchParams: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["status", "risk", "q"] as const) {
    const value = searchParams[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) params.set(key, single);
  }
  return params;
}

/** Canonical query string for a validated filter set (empty string for the defaults). */
export function filtersToQuery(filters: CaseListFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "PENDING") params.set("status", filters.status);
  if (filters.risk) params.set("risk", filters.risk);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

/** Builds the queue href that preserves the caller's validated filters. */
export function queueHref(searchParams: SearchParams): string {
  const filters = parseCaseListFilters(toURLSearchParams(searchParams));
  const query = filters ? filtersToQuery(filters) : "";
  return query ? `/kyc?${query}` : "/kyc";
}
