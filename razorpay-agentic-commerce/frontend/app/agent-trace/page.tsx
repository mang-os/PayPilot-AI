"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatINR, formatTimestamp, type AuditEventRow, type CheckoutRow } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

const ALERT_EVENTS = new Set([
  "POLICY_REJECTED",
  "MANDATE_REJECTED",
  "RAZORPAY_TIMEOUT",
  "ORDER_FAILED",
  "PAYMENT_FAILED",
  "WEBHOOK_SIGNATURE_INVALID",
  "AGENT_AUTH_FAILED",
  "ESCALATED",
]);
const VERIFIED_EVENTS = new Set([
  "POLICY_APPROVED",
  "MANDATE_VALIDATED",
  "PAYMENT_VERIFIED",
  "ORDER_COMPLETED",
  "AGENT_AUTHENTICATED",
  "RAZORPAY_ORDER_CREATED",
  "INVENTORY_RESERVED",
]);

function toneFor(eventType: string): "verified" | "alert" | "wire" {
  if (ALERT_EVENTS.has(eventType)) return "alert";
  if (VERIFIED_EVENTS.has(eventType)) return "verified";
  return "wire";
}

export default function AgentTracePage() {
  const [checkouts, setCheckouts] = useState<CheckoutRow[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .checkouts()
      .then((rows) => {
        setCheckouts(rows);
        if (rows.length > 0) setSelected(rows[0].checkout_id);
      })
      .catch(() => setError("Couldn't load checkouts."));
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.agentTrace(selected).then(setEvents).catch(() => setError("Couldn't load the trace for this checkout."));
  }, [selected]);

  const selectedCheckout = useMemo(
    () => checkouts?.find((c) => c.checkout_id === selected) ?? null,
    [checkouts, selected]
  );

  return (
    <div>
      <header>
        <h1 className="font-display text-2xl font-semibold text-ink">Agent Trace</h1>
        <p className="mt-1 max-w-lg font-sans text-sm text-inkmuted">
          Every check a checkout passed, in the exact order it passed them. Nothing here is
          summarized - these are the literal event codes the system emitted.
        </p>
      </header>

      {error && <p className="mt-6 font-mono text-sm text-alert">{error}</p>}

      {checkouts !== null && checkouts.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-hairline p-8 text-center">
          <p className="font-sans text-sm text-inkmuted">
            No checkouts yet. Run the demo buyer agent script to create one.
          </p>
        </div>
      )}

      {checkouts !== null && checkouts.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label htmlFor="checkout-picker" className="font-mono text-xs uppercase tracking-wide text-inkmuted">
              Checkout
            </label>
            <select
              id="checkout-picker"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-md border border-hairline bg-surface px-3 py-1.5 font-mono text-sm text-ink shadow-card"
            >
              {checkouts.map((c) => (
                <option key={c.checkout_id} value={c.checkout_id}>
                  {c.checkout_id} - {c.status} - {formatINR(c.final_amount)}
                </option>
              ))}
            </select>
            {selectedCheckout && <StatusBadge status={selectedCheckout.status} />}
          </div>

          <div className="trace-thread mt-8 space-y-6 pl-2">
            {events === null && <p className="font-mono text-sm text-inkmuted">Loading trace...</p>}
            {events !== null &&
              events.map((event) => {
                const tone = toneFor(event.event_type);
                const dotColor = tone === "alert" ? "bg-alert" : tone === "verified" ? "bg-seal" : "bg-wire";
                const textColor = tone === "alert" ? "text-alert" : tone === "verified" ? "text-verified" : "text-wire";
                return (
                  <div key={event.id} className="relative flex gap-4 pl-8">
                    <span className={`absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-surface ${dotColor} shadow-card`} />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`font-mono text-xs font-semibold uppercase tracking-wide ${textColor}`}>
                          {event.event_type}
                        </span>
                        <span className="font-mono text-[11px] text-inkmuted">{formatTimestamp(event.created_at)}</span>
                      </div>
                      <p className="mt-1 font-sans text-sm leading-relaxed text-ink">{event.message}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
