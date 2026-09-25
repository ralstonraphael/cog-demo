"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckBadge, RiskBadge, StatusBadge } from "@/components/badges";
import { LocalTime } from "@/components/local-time";
import { CHECK_RESULT_HINTS, EVIDENCE_FIELDS, STATUS_LABELS } from "@/lib/kyc/labels";
import type { CaseDetail, DecisionEvent } from "@/lib/kyc/types";
import { DecisionForm } from "./decision-form";

type Props = { initial: CaseDetail; canDecide: boolean; backHref: string };

/**
 * Case detail: evidence, decision controls (reviewers, pending cases only) and
 * history. State only changes after the server confirms a committed decision;
 * the authoritative case returned by the API replaces the loaded one.
 */
export function CaseView({ initial, canDecide, backHref }: Props) {
  const [current, setCurrent] = useState<CaseDetail>(initial);
  const [savedEvent, setSavedEvent] = useState<DecisionEvent | null>(null);

  const isPending = current.status === "PENDING";

  function onCommitted(updated: CaseDetail, event: DecisionEvent) {
    setCurrent(updated);
    setSavedEvent(event);
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={backHref}>← Back to queue</Link>
      </nav>

      <div className="page-header">
        <div>
          <h2>
            {current.id} <span className="customer-name">{current.customerName}</span>
          </h2>
          <dl className="summary">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={current.status} />
              </dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>
                <LocalTime iso={current.submittedAt} showAge />
              </dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>
                <RiskBadge level={current.riskLevel} />
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>v{current.version}</dd>
            </div>
          </dl>
        </div>
      </div>

      {savedEvent ? (
        <section className="card notice notice-success" role="status" aria-live="polite">
          <strong>Decision saved.</strong> {current.id} is now <StatusBadge status={current.status} /> (version{" "}
          {current.version}). Recorded by {savedEvent.actor.name} at <LocalTime iso={savedEvent.createdAt} />. This case
          no longer appears in the pending queue.
        </section>
      ) : null}

      <div className="detail-grid">
        <section className="card" aria-labelledby="evidence-title">
          <h3 id="evidence-title">Synthetic check results</h3>
          <p className="muted">
            Simulated provider labels for review. This application did not perform these checks and does not verify
            identity.
          </p>
          <table className="data-table evidence-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              {EVIDENCE_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  <td>
                    <CheckBadge result={current.evidence[f.key]} />
                  </td>
                  <td className="muted">{CHECK_RESULT_HINTS[current.evidence[f.key]]}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Provider reference</th>
                <td colSpan={2}>
                  <code>{current.evidence.providerReference}</code>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="evidence-summary">
            <strong>Summary:</strong> {current.evidence.summary}
          </p>
        </section>

        <section className="card" aria-labelledby="decision-title">
          <h3 id="decision-title">Decision</h3>
          {!canDecide ? (
            <p className="muted">
              <strong>Read-only access.</strong> Your role can inspect cases and history but cannot record decisions.
            </p>
          ) : isPending ? (
            <DecisionForm
              caseId={current.id}
              customerName={current.customerName}
              riskLevel={current.riskLevel}
              expectedVersion={current.version}
              onCommitted={onCommitted}
            />
          ) : (
            <p className="muted">
              This case is <strong>{STATUS_LABELS[current.status]}</strong>
              {current.status === "ESCALATED"
                ? " and is read-only until the supervisor workflow exists."
                : "; approved and rejected decisions are final."}{" "}
              No further decisions can be recorded.
            </p>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="history-title">
        <h3 id="history-title">History</h3>
        {current.history.length === 0 ? (
          <p className="muted">No decisions recorded yet.</p>
        ) : (
          <ol className="history">
            {current.history.map((e) => (
              <li key={e.id} className={savedEvent?.id === e.id ? "history-item is-new" : "history-item"}>
                <div className="history-head">
                  <strong>{e.actor.name}</strong>
                  <span>
                    {e.type === "DECISION" ? "Decision" : "Case created"}: {STATUS_LABELS[e.previousStatus]} →{" "}
                    {STATUS_LABELS[e.newStatus]}
                  </span>
                  <LocalTime iso={e.createdAt} />
                </div>
                <p className="history-reason">{e.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
