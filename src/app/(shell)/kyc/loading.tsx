export default function QueueLoading() {
  return (
    <section className="card" aria-busy="true" aria-live="polite">
      <p className="muted">Loading cases…</p>
    </section>
  );
}
