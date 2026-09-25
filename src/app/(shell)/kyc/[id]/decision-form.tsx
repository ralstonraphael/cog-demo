"use client";

import Link from "next/link";
import type { RiskLevel } from "@prisma/client";
import { useEffect, useId, useRef, useState } from "react";
import { StatusBadge } from "@/components/badges";
import { ACTION_LABELS } from "@/lib/kyc/labels";
import {
  ACTION_TO_STATUS,
  allowedActions,
  HIGH_RISK_POLICY_MESSAGE,
  type CaseDetail,
  type DecisionAction,
  type DecisionEvent,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from "@/lib/kyc/types";

type Props = {
  caseId: string;
  customerName: string;
  riskLevel: RiskLevel;
  /** Version loaded with the case; sent as expectedVersion, never refreshed before submit. */
  expectedVersion: number;
  onCommitted: (updated: CaseDetail, event: DecisionEvent) => void;
};

type SubmitError =
  | { kind: "validation"; message: string }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; message: string }
  | { kind: "notFound" }
  | { kind: "conflict"; currentStatus?: string }
  | { kind: "policy"; message: string }
  | { kind: "failure"; message: string };

type ErrorBody = { error?: { code?: string; message?: string; currentStatus?: string } };

const CONFLICT_MESSAGE = "This case changed while you were reviewing it. Reload to see the latest decision.";

export function DecisionForm({ caseId, customerName, riskLevel, expectedVersion, onCommitted }: Props) {
  const actions = allowedActions(riskLevel);
  const [action, setAction] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonId = useId();
  const hintId = useId();

  const trimmed = reason.trim();
  const reasonProblem =
    trimmed.length < REASON_MIN_LENGTH
      ? `Reason must be at least ${REASON_MIN_LENGTH} characters after trimming.`
      : trimmed.length > REASON_MAX_LENGTH
        ? `Reason must be at most ${REASON_MAX_LENGTH} characters after trimming.`
        : null;
  const canReview = action !== null && reasonProblem === null && !submitting;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  function openConfirmation() {
    setTouched(true);
    if (!canReview) return;
    setError(null);
    setConfirming(true);
  }

  async function submit() {
    if (action === null || submitting) return;
    setSubmitting(true);
    setError(null);
    const payload = { action, reason: trimmed, expectedVersion };

    let response: Response;
    try {
      response = await fetch(`/api/kyc-cases/${encodeURIComponent(caseId)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
    } catch {
      setSubmitting(false);
      setConfirming(false);
      setError({ kind: "failure", message: "The request could not reach the server. Your reason has been kept." });
      return;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const err = (body as ErrorBody | null)?.error;

    setSubmitting(false);
    setConfirming(false);

    if (response.ok && body && typeof body === "object" && "case" in body && "event" in body) {
      const ok = body as { case: CaseDetail; event: DecisionEvent };
      onCommitted(ok.case, ok.event);
      return;
    }

    switch (response.status) {
      case 400:
        setError({ kind: "validation", message: err?.message ?? "The server rejected this decision as invalid." });
        return;
      case 401:
        setError({ kind: "unauthenticated" });
        return;
      case 403:
        setError({
          kind: "forbidden",
          message: err?.message ?? "You do not have permission to record decisions. Nothing was saved.",
        });
        return;
      case 404:
        setError({ kind: "notFound" });
        return;
      case 409:
        setError({ kind: "conflict", currentStatus: err?.currentStatus });
        return;
      case 422:
        setAction(null);
        setError({ kind: "policy", message: err?.message ?? HIGH_RISK_POLICY_MESSAGE });
        return;
      default:
        setError({
          kind: "failure",
          message:
            response.status === 503
              ? "The database was busy and the decision was not recorded. Your reason has been kept."
              : "The server could not record the decision. Your reason has been kept.",
        });
    }
  }

  function reload() {
    window.location.reload();
  }

  const showReasonProblem = touched && reasonProblem !== null;
  const reasonInvalid = showReasonProblem || error?.kind === "validation";

  return (
    <form
      className="decision-form"
      onSubmit={(e) => {
        e.preventDefault();
        openConfirmation();
      }}
      noValidate
    >
      <fieldset className="action-group" disabled={submitting}>
        <legend>Action</legend>
        {riskLevel === "HIGH" ? (
          <p className="muted policy-note" role="note">
            {HIGH_RISK_POLICY_MESSAGE}
          </p>
        ) : null}
        {actions.map((a) => (
          <label key={a} className={`action-option action-${a.toLowerCase()}`}>
            <input
              type="radio"
              name="action"
              value={a}
              checked={action === a}
              onChange={() => setAction(a)}
              required
            />
            <span>
              {ACTION_LABELS[a]}
              <span className="muted"> → {ACTION_TO_STATUS[a] === "ESCALATED" ? "Awaiting supervisor review" : ACTION_TO_STATUS[a]}</span>
            </span>
          </label>
        ))}
        {touched && action === null ? (
          <p className="error" role="alert">
            Choose an action.
          </p>
        ) : null}
      </fieldset>

      <div className="field">
        <label htmlFor={reasonId}>Reason (required)</label>
        <textarea
          id={reasonId}
          name="reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={submitting}
          aria-describedby={hintId}
          aria-invalid={reasonInvalid || undefined}
          maxLength={REASON_MAX_LENGTH + 50}
        />
        <div id={hintId} className="reason-meta">
          <span className={reasonInvalid ? "error" : "muted"}>
            {showReasonProblem
              ? reasonProblem
              : error?.kind === "validation"
                ? error.message
                : `Explain the decision in ${REASON_MIN_LENGTH}–${REASON_MAX_LENGTH} characters.`}
          </span>
          <span className={trimmed.length > REASON_MAX_LENGTH ? "error" : "muted"} aria-live="polite">
            {trimmed.length}/{REASON_MAX_LENGTH}
          </span>
        </div>
      </div>

      {error && error.kind !== "validation" ? <ErrorNotice error={error} onRetry={submit} onReload={reload} /> : null}

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={submitting || (touched && !canReview)}>
          {submitting ? "Saving…" : "Review decision…"}
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
        onClose={() => setConfirming(false)}
        onCancel={(e) => {
          if (submitting) e.preventDefault();
        }}
      >
        <h3 id="confirm-title">Confirm decision</h3>
        <dl className="confirm-summary">
          <div>
            <dt>Case</dt>
            <dd>{caseId}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{customerName}</dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd>
              {action ? (
                <>
                  {ACTION_LABELS[action]} → <StatusBadge status={ACTION_TO_STATUS[action]} />
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd className="confirm-reason">{trimmed}</dd>
          </div>
        </dl>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setConfirming(false)} disabled={submitting} autoFocus>
            Cancel
          </button>
          <button
            className={`btn btn-primary btn-${action?.toLowerCase() ?? ""}`}
            type="button"
            onClick={submit}
            disabled={submitting || action === null}
          >
            {submitting ? "Saving…" : action ? `Confirm ${ACTION_LABELS[action].toLowerCase()}` : "Confirm"}
          </button>
        </div>
      </dialog>
    </form>
  );
}

function ErrorNotice({
  error,
  onRetry,
  onReload,
}: {
  error: Exclude<SubmitError, { kind: "validation" }>;
  onRetry: () => void;
  onReload: () => void;
}) {
  switch (error.kind) {
    case "unauthenticated":
      return (
        <div className="notice notice-error" role="alert">
          <p>Your sign-in has expired. Nothing was saved. Sign in again to continue.</p>
          <Link className="btn" href={`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
            Go to sign-in
          </Link>
        </div>
      );
    case "forbidden":
      return (
        <div className="notice notice-error" role="alert">
          <p>{error.message}</p>
        </div>
      );
    case "notFound":
      return (
        <div className="notice notice-error" role="alert">
          <p>This case no longer exists. Nothing was saved.</p>
          <Link className="btn" href="/kyc">
            Back to queue
          </Link>
        </div>
      );
    case "policy":
      return (
        <div className="notice notice-error" role="alert">
          <p>{error.message}</p>
          <p className="muted">Nothing was saved. Your reason has been kept; choose Reject or Escalate.</p>
        </div>
      );
    case "conflict":
      return (
        <div className="notice notice-error" role="alert">
          <p>{CONFLICT_MESSAGE}</p>
          {error.currentStatus ? <p className="muted">Recorded status on the server: {error.currentStatus}.</p> : null}
          <button className="btn" type="button" onClick={onReload}>
            Reload case
          </button>
        </div>
      );
    case "failure":
      return (
        <div className="notice notice-error" role="alert">
          <p>{error.message}</p>
          <div className="actions">
            <button className="btn btn-primary" type="button" onClick={onRetry}>
              Retry
            </button>
            <button className="btn" type="button" onClick={onReload}>
              Reload case
            </button>
          </div>
        </div>
      );
  }
}
