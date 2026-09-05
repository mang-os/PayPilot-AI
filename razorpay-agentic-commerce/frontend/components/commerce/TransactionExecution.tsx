"use client";

import { formatINR, formatTimestamp, type AuditEventRow, type CheckoutDetail } from "@/lib/api";
import { auditTimestamp, chronologicalEvents, eventViolations, transactionEvidence, type EvidenceState } from "@/lib/transaction-progress";
import s from "./TransactionExecution.module.css";

function EvidenceBadge({ value }: { value: EvidenceState }) {
  return <span className={s.badge} data-state={value.state}>{value.label}</span>;
}

function ControlRow({ label, value, evidence, note }: { label: string; value?: string; evidence?: EvidenceState; note?: string }) {
  return <div className={s.row} data-state={evidence?.state}>
    <dt>{label}</dt>
    {value && <dd className={s.value}>{value}</dd>}
    {evidence && <dd><EvidenceBadge value={evidence} /></dd>}
    {(evidence?.reason || note) && <dd className={s.note}>{evidence?.reason || note}</dd>}
  </div>;
}

export function eventEvidence(event: AuditEventRow) {
  const violations = eventViolations(event).map((value) => value.message).filter(Boolean);
  if (violations.length) return violations.join(" ");
  if (event.event_type === "CHECKOUT_CREATED" || event.event_type === "CHECKOUT_UPDATED") {
    const recordedAmount = event.message.match(/final_amount=(\d+(?:\.\d+)?)/)?.[1];
    if (recordedAmount) return `Cart ${event.event_type === "CHECKOUT_CREATED" ? "created" : "updated"} · ${formatINR(Number(recordedAmount))}`;
  }
  const summaries: Record<string, string> = {
    POLICY_APPROVED: "Merchant policy satisfied.",
    MANDATE_VALIDATED: "Spending authority validated for this purchase.",
    INVENTORY_RESERVED: "Stock reserved while payment is pending.",
    RAZORPAY_ORDER_CREATED: "Razorpay order created after financial approval.",
    PAYMENT_VERIFIED: "Payment verified by the backend webhook.",
    ORDER_COMPLETED: "Purchase completed and recorded.",
  };
  if (summaries[event.event_type]) return summaries[event.event_type];
  // Do not backfill old events with the checkout's latest amount or inventory.
  return event.message || "No additional evidence was recorded.";
}

export function AuditEvidence({ events }: { events: AuditEventRow[] | null }) {
  const ordered = chronologicalEvents(events ?? []);
  return <section className={s.audit} aria-labelledby="execution-audit-title">
    <div className={s.auditHeading}>
      <h2 id="execution-audit-title">Audit evidence</h2>
      <span>{events === null ? "Loading" : `${events.length} ${events.length === 1 ? "event" : "events"}`}</span>
    </div>
    <p className={s.auditIntro}>Recorded events for this checkout, in chronological order.</p>
    {events === null && <p className={s.empty}>Loading audit evidence…</p>}
    {events?.length === 0 && <p className={s.empty}>No audit events have been recorded for this checkout.</p>}
    <ol className={s.events}>
      {ordered.map((event) => <li key={event.id} className={s.event}>
        <time dateTime={auditTimestamp(event.created_at)} title={formatTimestamp(event.created_at)}>{new Date(auditTimestamp(event.created_at)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time>
        <div className={s.eventBody}>
          <code>{event.event_type}</code>
          <p>{eventEvidence(event)}</p>
          <details>
            <summary>Event details</summary>
            <p>{event.message}</p>
            <p>{formatTimestamp(event.created_at)}</p>
            {event.payload && <pre>{JSON.stringify(event.payload, null, 2)}</pre>}
          </details>
        </div>
      </li>)}
    </ol>
  </section>;
}

export default function TransactionExecution({ checkout, events, intent, onReturnToStore }: {
  checkout: CheckoutDetail;
  events: AuditEventRow[] | null;
  intent: string | null;
  onReturnToStore: () => void;
}) {
  const model = transactionEvidence(checkout, events ?? []);
  const quantity = checkout.items.reduce((total, item) => total + item.quantity, 0);
  const products = checkout.items.map((item) => item.name).join(", ") || "Not recorded";
  const amount = formatINR(checkout.final_amount);
  return <div className={s.execution}>
    <section className={s.summary} aria-label="Current transaction summary">
      <div className={s.identity}>
        <div><span className={s.label}>Checkout ID</span><p className={s.checkoutId}>{checkout.checkout_id}</p></div>
        <EvidenceBadge value={{ label: model.status, state: model.completed ? "completed" : model.failureStage ? "failed" : "active" }} />
      </div>
      <dl className={s.facts}>
        <div><dt>Selected product</dt><dd>{products}</dd></div>
        <div><dt>Quantity</dt><dd>{quantity}</dd></div>
        <div><dt>Final amount</dt><dd className={s.amount}>{amount}</dd></div>
      </dl>
      <div className={s.intent}><span className={s.label}>Original buyer intent</span><p>{intent ? `“${intent}”` : "Not recorded for this checkout"}</p></div>
    </section>

    <div className={s.phase} data-state={model.failureStage ? "failed" : model.completed ? "completed" : "active"} role="status">
      <span className={s.dot} aria-hidden="true" /><strong>{model.phaseLabel}</strong>
      <span>AI proposes the purchase. Financial controls gate payment.</span>
    </div>
    <section className={s.columns} aria-label="Transaction execution">
      <article className={s.column}>
        <h2>AI decision</h2>
        <dl>
          <ControlRow label="Product selected" value={checkout.items.map((item) => `${item.name} × ${item.quantity}`).join(", ") || "Not recorded"} />
          <ControlRow label="Offer applied" value={checkout.offer_code || "No offer applied"} />
          <ControlRow label="Cart created" value={amount} />
        </dl>
      </article>
      <article className={`${s.column} ${s.controls}`}>
        <h2>Financial control</h2>
        <dl>
          <ControlRow label="Policy" evidence={model.policy} />
          <ControlRow label="Spending Authority" value={checkout.mandate ? `${amount} / ${formatINR(checkout.mandate.max_amount)}` : "No authority recorded"} evidence={model.authority} />
          <ControlRow label="Inventory" value={`${quantity} ${quantity === 1 ? "unit" : "units"} requested`} evidence={model.inventory} note="Available quantity was not recorded in this checkout’s audit." />
        </dl>
      </article>
      <article className={s.column}>
        <h2>Payment</h2>
        <dl>
          <ControlRow label="Razorpay order" value={checkout.razorpay_order_id || undefined} evidence={model.razorpay} />
          <ControlRow label="Webhook" evidence={model.webhook} />
          <ControlRow label="Payment" evidence={model.payment} />
        </dl>
        {model.failureStage === "checks" && <p className={s.stopNote}>This attempt stopped before Razorpay. No payment was attempted.</p>}
      </article>
    </section>
    {model.reason && <p role="alert" className={s.failure}>{model.reason}</p>}
    <AuditEvidence events={events} />
    <button type="button" className={s.returnLink} onClick={onReturnToStore}>View this purchase in Buyer <span aria-hidden="true">→</span></button>
  </div>;
}
