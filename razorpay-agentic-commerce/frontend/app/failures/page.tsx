"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import {
  api,
  formatINR,
  formatTimestamp,
  type AuditEventRow,
  type CheckoutDetail,
  type FailuresResponse,
} from "@/lib/api";

const BLOCKING_EVENTS = new Set([
  "POLICY_REJECTED",
  "MANDATE_REJECTED",
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "INVENTORY_UNAVAILABLE",
  "RAZORPAY_TIMEOUT",
  "PAYMENT_FAILED",
  "WEBHOOK_SIGNATURE_INVALID",
  "ORDER_FAILED",
]);

type SafetyViolation = {
  code: string;
  title: string;
  message: string;
  createdAt: string | null;
};

function violationTitle(code: string) {
  if (code.startsWith("AGENT_AUTH_")) return "Agent authentication";
  if (code.startsWith("MANDATE_")) return "Spending Authority";
  if (code === "INVENTORY_UNAVAILABLE") return "Inventory";
  if (code.startsWith("RAZORPAY_")) return "Razorpay";
  if (code.startsWith("PAYMENT_") || code.startsWith("WEBHOOK_")) return "Payment Verification";
  if (code.startsWith("ORDER_")) return "Transaction";
  return "Policy";
}

function policyViolations(event: AuditEventRow): SafetyViolation[] {
  const violations = event.payload?.violations;
  if (!Array.isArray(violations)) return [];

  return violations.flatMap((violation) => {
    if (typeof violation !== "object" || violation === null) return [];
    const value = violation as { code?: unknown; message?: unknown };
    if (typeof value.code !== "string" || typeof value.message !== "string") return [];
    return [{
      code: value.code,
      title: violationTitle(value.code),
      message: value.message,
      createdAt: event.created_at,
    }];
  });
}

function currentViolations(checkout: CheckoutDetail, events: AuditEventRow[]): SafetyViolation[] {
  if (checkout.status !== "FAILED") return [];

  const violations = events.flatMap((event) => {
    if (event.event_type === "POLICY_REJECTED") {
      const specific = policyViolations(event);
      if (specific.length > 0) return specific;
    }
    if (!BLOCKING_EVENTS.has(event.event_type)) return [];
    return [{
      code: event.event_type,
      title: violationTitle(event.event_type),
      message: event.message,
      createdAt: event.created_at,
    }];
  });

  if (violations.length === 0) {
    violations.push({
      code: "CHECKOUT_FAILED",
      title: "Purchase",
      message: checkout.failure_reason ?? "This checkout is in a failed state, but no failure reason was recorded.",
      createdAt: checkout.updated_at,
    });
  }

  return violations.filter((violation, index) => (
    violations.findIndex((candidate) => (
      candidate.code === violation.code && candidate.message === violation.message
    )) === index
  ));
}

function FailureEvent({ event }: { event: AuditEventRow }) {
  const duplicateCheckout = event.event_type === "DUPLICATE_CHECKOUT_DETECTED";
  const specificViolations = event.event_type === "POLICY_REJECTED" ? policyViolations(event) : [];
  const title = duplicateCheckout
    ? "Duplicate checkout prevented"
    : specificViolations.length === 1 ? specificViolations[0].title : violationTitle(event.event_type);
  const message = specificViolations.length > 0
    ? specificViolations.map((violation) => violation.message).join(" ")
    : event.message;
  const codeTone = duplicateCheckout ? "text-pay" : "text-err";
  const details = event.event_type === "POLICY_REJECTED" ? policyViolations(event) : [];

  return (
    <article className="rounded-lg border border-border bg-s1 px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className="font-display text-base font-semibold text-hi">{title}</h3>
          <p className={`mt-1 font-mono text-[11px] font-medium uppercase tracking-wider ${codeTone}`}>
            {event.event_type}
          </p>
        </div>
        <p className="font-mono text-[10px] text-lo">{formatTimestamp(event.created_at)}</p>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-hi/85">{message}</p>
      {details.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-err/30 pl-3">
          {details.map((detail) => (
            <li key={`${detail.code}-${detail.message}`} className="text-sm leading-relaxed text-hi/85">
              <span className="font-medium text-hi">{detail.title}:</span> {detail.message}
            </li>
          ))}
        </ul>
      )}
      {duplicateCheckout && (
        <p className="mt-3 border-l-2 border-pay/50 pl-3 text-xs leading-relaxed text-lo">
          The existing checkout was returned instead of creating another order.
        </p>
      )}
      {event.checkout_id && (
        <p className="mt-3 break-all font-mono text-[10px] text-lo">Checkout · {event.checkout_id}</p>
      )}
    </article>
  );
}

export default function SafetyPage() {
  const requestId = useRef(0);
  const [currentCheckoutId, setCurrentCheckoutId] = useState("");
  const [buyerIntent, setBuyerIntent] = useState("");
  const [checkout, setCheckout] = useState<CheckoutDetail | null>(null);
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [data, setData] = useState<FailuresResponse | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function load() {
    const activeRequest = ++requestId.current;
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout")?.trim() ?? "";
    const intent = params.get("intent")?.trim() ?? "";

    setCurrentCheckoutId(checkoutId);
    setBuyerIntent(intent);
    setCheckout(null);
    setEvents(null);
    setData(null);
    setCurrentError(null);
    setHistoryError(null);

    const [historyResult, currentResult] = await Promise.allSettled([
      api.failures(),
      checkoutId
        ? Promise.all([api.checkoutDetail(checkoutId), api.agentTrace(checkoutId)])
        : Promise.resolve(null),
    ]);

    if (activeRequest !== requestId.current) return;

    if (historyResult.status === "fulfilled") setData(historyResult.value);
    else setHistoryError("Could not load historical safety events.");

    if (!checkoutId) {
      setEvents([]);
    } else if (currentResult.status === "fulfilled" && currentResult.value) {
      setCheckout(currentResult.value[0]);
      setEvents(currentResult.value[1]);
    } else {
      setCurrentError("Could not load this checkout and its audit evidence.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const violations = useMemo(
    () => checkout && events ? currentViolations(checkout, events) : [],
    [checkout, events],
  );
  const historicalEvents = useMemo(
    () => data?.failure_events.filter((event) => event.checkout_id !== currentCheckoutId) ?? [],
    [currentCheckoutId, data],
  );
  const historicalFailedCheckouts = useMemo(
    () => data?.failed_checkouts.filter((item) => item.checkout_id !== currentCheckoutId) ?? [],
    [currentCheckoutId, data],
  );
  const historicalReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const event of data?.failure_events ?? []) {
      if (!event.checkout_id || reasons.has(event.checkout_id)) continue;
      const specific = event.event_type === "POLICY_REJECTED" ? policyViolations(event) : [];
      reasons.set(
        event.checkout_id,
        specific.length > 0 ? specific.map((violation) => violation.message).join(" ") : event.message,
      );
    }
    return reasons;
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-5 border-b border-border pb-7">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ai">
            PayPilot AI · Merchant Control
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-hi">Safety</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-lo">
            Review the safeguards applied to the current AI purchase, with older safety evidence kept separately below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void load(); }}
          className="min-h-11 rounded-lg border border-border bg-s1 px-4 text-sm font-medium text-hi shadow-card transition-colors hover:border-ai/50 hover:text-ai"
        >
          Refresh
        </button>
      </header>

      <section aria-labelledby="current-transaction-title">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ai">Current transaction</p>
        <h2 id="current-transaction-title" className="mt-2 font-display text-2xl font-semibold text-hi">Safety status for this purchase</h2>

        {!currentCheckoutId && (
          <div className="mt-5 rounded-xl border border-dashed border-border bg-s1 px-6 py-10 text-center">
            <p className="text-sm text-lo">Open Safety from a Buyer or Merchant Control purchase to inspect its exact checkout.</p>
          </div>
        )}

        {currentCheckoutId && !checkout && !currentError && (
          <div className="mt-5 rounded-xl border border-border bg-s1 p-6 shadow-card">
            <p className="font-mono text-xs text-lo">Loading the current transaction…</p>
          </div>
        )}

        {currentError && (
          <p role="alert" className="mt-5 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-sm text-err">
            {currentError}
          </p>
        )}

        {checkout && events && (
          <div className="mt-5 rounded-xl border border-border bg-s1 p-5 shadow-card sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lo">Checkout</p>
                <p className="mt-1 break-all font-mono text-xs text-hi">{checkout.checkout_id}</p>
              </div>
              <StatusBadge status={checkout.status === "COMPLETED" ? "COMPLETE" : checkout.status === "FAILED" ? "BLOCKED" : checkout.razorpay_order_id ? "AWAITING PAYMENT" : "PROCESSING"} />
            </div>

            <dl className="grid gap-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-lo">Buyer intent</dt>
                <dd className="mt-2 text-sm leading-relaxed text-hi">{buyerIntent ? `“${buyerIntent}”` : "Not provided in this link"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-lo">Product</dt>
                <dd className="mt-2 text-sm leading-relaxed text-hi">
                  {checkout.items.map((item) => `${item.name} × ${item.quantity}`).join(" · ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-lo">Amount</dt>
                <dd className="ledger-figure mt-2 font-display text-lg font-semibold text-hi">{formatINR(checkout.final_amount)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-lo">Razorpay</dt>
                <dd className="mt-2 break-all font-mono text-[11px] text-hi">{checkout.razorpay_order_id ?? "Not invoked"}</dd>
              </div>
            </dl>

            <div className="border-t border-border pt-5">
              {violations.length === 0 ? (
                <div className="rounded-lg border border-ok/30 bg-ok/5 px-4 py-4">
                  <p className="font-medium text-ok">No active safety violations for this transaction.</p>
                  <p className="mt-1 text-sm text-lo">Current status is derived only from this checkout and its audit trail.</p>
                </div>
              ) : (
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-err">Active safety violations</p>
                  <div className="mt-3 space-y-3">
                    {violations.map((violation) => (
                      <article key={`${violation.code}-${violation.message}`} className="rounded-lg border border-err/30 bg-err/5 px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-display text-base font-semibold text-hi">{violation.title}</h3>
                            <p className="mt-1 font-mono text-[10px] font-medium uppercase tracking-wider text-err">{violation.code}</p>
                          </div>
                          {violation.createdAt && <p className="font-mono text-[10px] text-lo">{formatTimestamp(violation.createdAt)}</p>}
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-hi/85">{violation.message}</p>
                        {violation.code === "MANDATE_AMOUNT_EXCEEDED" && checkout.mandate && (
                          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-err/20 pt-3">
                            <div><dt className="text-xs text-lo">Requested</dt><dd className="ledger-figure mt-1 font-medium text-hi">{formatINR(checkout.final_amount)}</dd></div>
                            <div><dt className="text-xs text-lo">Authorized</dt><dd className="ledger-figure mt-1 font-medium text-hi">{formatINR(checkout.mandate.max_amount)}</dd></div>
                          </dl>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8" aria-labelledby="historical-safety-title">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-lo">Historical safety events</p>
        <h2 id="historical-safety-title" className="mt-2 font-display text-2xl font-semibold text-hi">Earlier safeguards and failures</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-lo">
          Historical records are retained for auditability and are not the status of the current transaction above.
        </p>

        {historyError && (
          <p role="alert" className="mt-5 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-sm text-err">{historyError}</p>
        )}
        {data === null && !historyError && <p className="mt-5 font-mono text-xs text-lo">Loading historical safety events…</p>}

        {data && historicalEvents.length === 0 && historicalFailedCheckouts.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-border bg-s1 px-6 py-10 text-center">
            <p className="text-sm text-lo">No historical safety events have been recorded.</p>
          </div>
        )}

        {(historicalEvents.length > 0 || historicalFailedCheckouts.length > 0) && (
          <details className="mt-5 rounded-xl border border-border bg-s1 p-4 shadow-card sm:p-5">
            <summary className="cursor-pointer text-sm font-medium text-hi">
              Review {historicalEvents.length} historical event{historicalEvents.length === 1 ? "" : "s"} and {historicalFailedCheckouts.length} failed checkout{historicalFailedCheckouts.length === 1 ? "" : "s"}
            </summary>

            {historicalEvents.length > 0 && (
              <div className="mt-5 space-y-3" aria-label="Historical safety event list">
                {historicalEvents.map((event) => <FailureEvent key={event.id} event={event} />)}
              </div>
            )}

            {historicalFailedCheckouts.length > 0 && (
              <div className="mt-8" aria-labelledby="historical-failed-checkouts-title">
                <h3 id="historical-failed-checkouts-title" className="font-display text-lg font-semibold text-hi">Failed checkouts in history</h3>
                <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-s1">
                  <table className="w-full min-w-[620px] text-left">
                    <thead>
                      <tr className="border-b border-border bg-s2">
                        {["Checkout", "Reason", "Amount", "Last updated"].map((heading) => (
                          <th key={heading} className="px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-widest text-lo">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historicalFailedCheckouts.map((item) => (
                        <tr key={item.checkout_id} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-3 font-mono text-[11px] text-hi">{item.checkout_id}</td>
                          <td className="px-4 py-3 text-xs text-err">{historicalReasons.get(item.checkout_id) ?? item.failure_reason ?? "Failure reason unavailable"}</td>
                          <td className="ledger-figure px-4 py-3 font-mono text-sm text-hi">{formatINR(item.final_amount)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-lo">{formatTimestamp(item.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </details>
        )}
      </section>
    </div>
  );
}
