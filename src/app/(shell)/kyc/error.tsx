"use client";

import Link from "next/link";

/** Route-level failure state for the queue and case pages; never shows internals. */
export default function KycError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card" role="alert" aria-labelledby="kyc-error-title">
      <h2 id="kyc-error-title">Something went wrong loading this page</h2>
      <p className="muted">The request failed on the server. No decision was recorded by this page load.</p>
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn" href="/kyc">
          Back to queue
        </Link>
      </div>
    </section>
  );
}
