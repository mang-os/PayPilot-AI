"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import TransactionExecution, { eventEvidence } from "@/components/commerce/TransactionExecution";
import { transactionEvidence } from "@/lib/transaction-progress";
import {
  api,
  formatINR,
  formatTimestamp,
  type AuditEventRow,
  type CheckoutDetail,
  type CheckoutRow,
} from "@/lib/api";

const ALERT_EVENTS = new Set([
  "POLICY_REJECTED",
  "MANDATE_REJECTED",
  "MANDATE_EXPIRED",
  "MANDATE_AMOUNT_EXCEEDED",
  "INVENTORY_UNAVAILABLE",
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

const FRIENDLY_EVENT_TITLES: Record<string, string> = {
  REQUEST_RECEIVED: "Request received",
  AGENT_AUTHENTICATED: "Agent authenticated",
  AGENT_AUTH_FAILED: "Agent authentication failed",
  PRODUCT_SEARCH: "Products considered",
  INVENTORY_VERIFIED: "Catalog inventory checked",
  OFFER_SELECTED: "Offer selected",
  MANDATE_CREATED: "Spending authority created",
  MANDATE_VALIDATED: "Spending authority validated",
  MANDATE_REJECTED: "Spending authority rejected",
  MANDATE_EXPIRED: "Spending authority expired",
  MANDATE_AMOUNT_EXCEEDED: "Spending authority exceeded",
  CHECKOUT_CREATED: "Checkout created",
  CHECKOUT_UPDATED: "Checkout updated",
  POLICY_APPROVED: "Policy approved",
  POLICY_REJECTED: "Purchase blocked by policy",
  INVENTORY_RESERVED: "Inventory reserved",
  INVENTORY_UNAVAILABLE: "Inventory unavailable",
  RAZORPAY_ORDER_CREATED: "Razorpay order created",
  RAZORPAY_TIMEOUT: "Razorpay did not respond",
  WEBHOOK_RECEIVED: "Webhook received",
  WEBHOOK_SIGNATURE_INVALID: "Webhook signature rejected",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_FAILED: "Payment failed",
  ORDER_COMPLETED: "Transaction completed",
  ORDER_FAILED: "Transaction failed",
  DUPLICATE_CHECKOUT_DETECTED: "Duplicate checkout prevented",
  DUPLICATE_COMPLETION_DETECTED: "Duplicate completion prevented",
  ESCALATED: "Manual attention requested",
};

type Violation = { code: string; message?: string };

type TransactionSummary = {
  businessStatus: string;
  policy: string;
  spendingAuthority: string;
  inventory: string;
  razorpayOrder: string;
  payment: string;
  webhook: string;
  transaction: string;
};

type BuyerContext = {
  intent: string;
  matchedProducts: string[];
  rationale: string;
  offer: { code: string; description: string } | null;
};

function buyerContextFor(checkoutId: string): BuyerContext | null {
  try {
    const raw = window.sessionStorage.getItem(`paypilot:checkout:${checkoutId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const matchedProducts = Array.isArray(value.matchedProducts)
      ? value.matchedProducts.filter((item): item is string => typeof item === "string")
      : [];
    const offerValue = typeof value.offer === "object" && value.offer !== null
      ? value.offer as Record<string, unknown>
      : null;
    const offer = offerValue && typeof offerValue.code === "string" && typeof offerValue.description === "string"
      ? { code: offerValue.code, description: offerValue.description }
      : null;
    return {
      intent: typeof value.intent === "string" ? value.intent : "",
      matchedProducts,
      rationale: typeof value.rationale === "string" ? value.rationale : "",
      offer,
    };
  } catch {
    return null;
  }
}

function violationsFrom(events: AuditEventRow[]): Violation[] {
  return events.flatMap((event) => {
    if (event.event_type !== "POLICY_REJECTED" || !Array.isArray(event.payload?.violations)) return [];
    return event.payload.violations.filter((entry): entry is Violation => (
      typeof entry === "object"
      && entry !== null
      && typeof (entry as { code?: unknown }).code === "string"
    ));
  });
}

function summarizeTransaction(checkout: CheckoutDetail, events: AuditEventRow[]): TransactionSummary {
  const evidence = transactionEvidence(checkout, events);
  return {
    businessStatus: evidence.status,
    policy: evidence.policy.label,
    spendingAuthority: evidence.authority.label,
    inventory: evidence.inventory.label,
    razorpayOrder: evidence.razorpay.label,
    payment: evidence.payment.label,
    webhook: evidence.webhook.label,
    transaction: evidence.completed ? "COMPLETE" : evidence.failureStage ? "BLOCKED" : "PROCESSING",
  };
}

function toneFor(eventType: string): "ok" | "err" | "ai" {
  if (ALERT_EVENTS.has(eventType)) return "err";
  if (VERIFIED_EVENTS.has(eventType)) return "ok";
  return "ai";
}

function humanViolationReason(event: AuditEventRow): string | null {
  if (event.event_type !== "POLICY_REJECTED" || !Array.isArray(event.payload?.violations)) return null;
  const messages = event.payload.violations.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const message = (entry as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? [message.trim()] : [];
  });
  return messages.length > 0 ? messages.join(" ") : null;
}

function friendlyEventTitle(event: AuditEventRow): string {
  if (event.event_type === "POLICY_REJECTED") {
    const violations = violationsFrom([event]);
    if (violations.length > 0 && violations.every((violation) => violation.code.startsWith("MANDATE_"))) return "Spending authority rejected";
    if (violations.length > 0 && violations.every((violation) => violation.code === "INVENTORY_UNAVAILABLE")) return "Inventory unavailable";
  }
  return FRIENDLY_EVENT_TITLES[event.event_type]
    ?? event.event_type.toLowerCase().replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function itemSummary(checkout: CheckoutDetail): string {
  if (checkout.items.length === 0) return "No line items recorded";
  return checkout.items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
}

function SummaryRow({ label, value, status }: { label: string; value?: string; status: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[#E3E8EF] py-3 last:border-0">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-[#0B1220]">{label}</dt>
        {value && <dd className="mt-1 break-all font-mono text-[11px] text-[#667085]">{value}</dd>}
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export default function MerchantControlPage() {
  const router = useRouter();
  const [checkouts, setCheckouts] = useState<CheckoutRow[] | null>(null);
  const [selected, setSelected] = useState("");
  const [checkout, setCheckout] = useState<CheckoutDetail | null>(null);
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [explicitIntent, setExplicitIntent] = useState<string | null>(null);
  const [buyerContext, setBuyerContext] = useState<BuyerContext | null>(null);
  const [activeView, setActiveView] = useState("overview");

  useEffect(() => {
    const syncView = () => setActiveView(window.location.hash.slice(1) || "overview");
    syncView();
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    return () => {
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncExplicitSelection = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedCheckout = params.get("checkout")?.trim() ?? "";
      setSelected(requestedCheckout);
      setExplicitIntent(requestedCheckout ? params.get("intent")?.trim() || null : null);
    };
    syncExplicitSelection();
    window.addEventListener("popstate", syncExplicitSelection);
    api.checkouts()
      .then((rows) => {
        if (cancelled) return;
        setCheckouts(rows);
        setPickerError(null);
      })
      .catch(() => {
        if (!cancelled) setPickerError("Couldn't load the checkout picker.");
      });
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", syncExplicitSelection);
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setCheckout(null);
      setEvents(null);
      setEvidenceError(null);
      setBuyerContext(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    setCheckout(null);
    setEvents(null);
    setEvidenceError(null);
    setBuyerContext(buyerContextFor(selected));

    async function loadEvidence() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [detail, trace] = await Promise.allSettled([api.checkoutDetail(selected), api.agentTrace(selected)]);
        if (cancelled) return;
        if (detail.status === "fulfilled") setCheckout(detail.value);
        if (trace.status === "fulfilled") setEvents(trace.value);
        if (detail.status === "fulfilled" && trace.status === "fulfilled") {
          setEvidenceError(null);
        } else {
          setEvidenceError(
            detail.status === "rejected" && trace.status === "rejected"
              ? "Couldn't load the details and audit trail for this checkout."
              : detail.status === "rejected"
                ? "Couldn't load checkout details for the selected transaction."
                : "Couldn't load the audit trail for this checkout.",
          );
        }
      } finally {
        inFlight = false;
      }
    }
    void loadEvidence();
    const interval = window.setInterval(loadEvidence, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selected]);

  const summary = useMemo(() => checkout ? summarizeTransaction(checkout, events ?? []) : null, [checkout, events]);
  const buyerIntent = explicitIntent || buyerContext?.intent || null;

  const updateSelection = (checkoutId: string) => {
    setCheckout(null);
    setEvents(null);
    setEvidenceError(null);
    setExplicitIntent(null);
    setBuyerContext(checkoutId ? buyerContextFor(checkoutId) : null);
    setSelected(checkoutId);
    const target = new URL(window.location.href);
    if (checkoutId) target.searchParams.set("checkout", checkoutId);
    else target.searchParams.delete("checkout");
    target.searchParams.delete("intent");
    window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0B1220]">
      <div className="mx-auto max-w-[1280px]">
        <header className="mb-8">
          <p className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-[#4F46E5]">{activeView === "execution" ? "Execution" : "PayPilot AI"}</p>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight text-[#0B1220] md:text-[34px]">{activeView === "execution" ? "Transaction execution" : "Merchant Control"}</h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-[#667085]">{activeView === "execution" ? "See exactly how this AI purchase moved from intent to verified payment." : "Monitor the AI purchase, financial controls, payment execution, and audit evidence."}</p>
        </header>

        <div className="mb-6">
          <label htmlFor="checkout-picker" className="block text-sm font-medium text-[#667085]">Current checkout</label>
          <select id="checkout-picker" value={selected} onChange={(event) => updateSelection(event.target.value)} className="mt-2 min-h-11 w-full max-w-2xl rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0B1220] focus:border-[#4F46E5]">
            <option value="">{checkouts?.length === 0 ? "No checkouts available" : "Select a checkout"}</option>
            {selected && checkouts && !checkouts.some((row) => row.checkout_id === selected) && <option value={selected}>{selected}</option>}
            {checkouts?.map((row) => <option key={row.checkout_id} value={row.checkout_id}>{row.checkout_id} — {row.status} — {formatINR(row.final_amount)}</option>)}
          </select>
          {checkouts === null && !pickerError && <p className="mt-2 text-xs text-[#667085]">Loading checkout choices…</p>}
          {pickerError && <p className="mt-2 text-sm text-[#B42318]">{pickerError}</p>}
        </div>

        {evidenceError && <p role="alert" className="mb-6 border-l-2 border-[#B42318] bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]">{evidenceError}</p>}

        {!selected && (
          <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white px-6 py-14 text-center">
            <h2 className="text-xl font-semibold text-[#0B1220]">Select a current transaction</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-[#667085]">Merchant Control remains blank until a checkout is explicitly selected. It never substitutes a historical transaction.</p>
          </div>
        )}
        {selected && checkout === null && !evidenceError && <p className="rounded-xl border border-[#E3E8EF] bg-white px-5 py-8 text-sm text-[#667085]">Loading the selected transaction…</p>}

        {checkout && summary && (
          <>
            <section id="overview" aria-labelledby="overview-title" className="scroll-mt-32" hidden={activeView !== "overview"}>
              <div className="mb-5">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#667085]">Current transaction</p>
                <h2 id="overview-title" className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#0B1220]">Overview</h2>
              </div>
              <div className="rounded-xl border border-[#E3E8EF] bg-white p-5 sm:p-6">
                <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
                  <div><dt className="text-xs font-medium text-[#667085]">Checkout</dt><dd className="mt-2 break-all font-mono text-xs text-[#0B1220]">{checkout.checkout_id}</dd></div>
                  <div><dt className="text-xs font-medium text-[#667085]">Buyer intent</dt><dd className="mt-2 text-sm text-[#0B1220]">{buyerIntent ? `“${buyerIntent}”` : "Not recorded for this checkout"}</dd></div>
                  <div><dt className="text-xs font-medium text-[#667085]">Product</dt><dd className="mt-2 text-sm font-medium text-[#0B1220]">{itemSummary(checkout)}</dd></div>
                  <div><dt className="text-xs font-medium text-[#667085]">Amount</dt><dd className="mt-2 text-xl font-semibold tabular-nums text-[#0B1220]">{formatINR(checkout.final_amount)}</dd></div>
                  <div><dt className="text-xs font-medium text-[#667085]">Status</dt><dd className="mt-2"><StatusBadge status={summary.businessStatus} /></dd></div>
                </dl>
              </div>

              <div className="my-5 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] px-5 py-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[#4338CA]">
                <span>PayPilot AI · AI Decision</span><span aria-hidden="true">→</span><strong>Financial Trust Boundary</strong><span aria-hidden="true">→</span><span>Deterministic controls · Razorpay</span>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                <article className="rounded-xl border border-[#C7D2FE] bg-white p-5 sm:p-6">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#4F46E5]">AI Decision</p>
                  <dl className="mt-4 space-y-4 text-sm">
                    <div><dt className="text-[#667085]">Intent</dt><dd className="mt-1 text-[#0B1220]">{buyerIntent ?? "Not recorded for this checkout"}</dd></div>
                    <div><dt className="text-[#667085]">Matched products</dt><dd className="mt-1 text-[#0B1220]">{buyerContext?.matchedProducts.length ? buyerContext.matchedProducts.join(" · ") : "Not recorded for this checkout"}</dd></div>
                    <div><dt className="text-[#667085]">Selected product</dt><dd className="mt-1 font-medium text-[#0B1220]">{itemSummary(checkout)}</dd></div>
                    <div><dt className="text-[#667085]">Why</dt><dd className="mt-1 text-[#0B1220]">{buyerContext?.rationale || "Not recorded for this checkout"}</dd></div>
                    <div><dt className="text-[#667085]">Offer</dt><dd className="mt-1 text-[#0B1220]">{buyerContext?.offer ? `${buyerContext.offer.code} · ${buyerContext.offer.description}` : checkout.offer_code ?? "No offer applied"}</dd></div>
                  </dl>
                </article>
                <article className="rounded-xl border border-[#E3E8EF] bg-white p-5 sm:p-6">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#667085]">Financial Controls</p>
                  <dl className="mt-2">
                    <SummaryRow label="Policy" status={summary.policy} />
                    <SummaryRow label="Spending Authority" value={checkout.mandate ? `${formatINR(checkout.final_amount)} / ${formatINR(checkout.mandate.max_amount)}` : undefined} status={summary.spendingAuthority} />
                    <SummaryRow label="Inventory" status={summary.inventory} />
                  </dl>
                </article>
                <article className="rounded-xl border border-[#E3E8EF] bg-white p-5 sm:p-6">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#667085]">Payment</p>
                  <dl className="mt-2">
                    <SummaryRow label="Razorpay order" value={checkout.razorpay_order_id ?? undefined} status={summary.razorpayOrder} />
                    <SummaryRow label="Payment" status={summary.payment} />
                    <SummaryRow label="Webhook" status={summary.webhook} />
                    <SummaryRow label="Transaction" status={summary.transaction} />
                  </dl>
                </article>
              </div>
            </section>

            {activeView === "execution" && (
              <section id="execution" aria-label="Execution" className="scroll-mt-32">
                <TransactionExecution
                  checkout={checkout}
                  events={events}
                  intent={buyerIntent}
                  onReturnToStore={() => {
                    const params = new URLSearchParams({ checkout: selected });
                    if (buyerIntent) params.set("intent", buyerIntent);
                    router.push(`/?${params.toString()}`);
                  }}
                />
              </section>
            )}

            <section id="audit-trail" aria-labelledby="audit-trail-title" className="scroll-mt-32 pb-10" hidden={activeView !== "audit-trail"}>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#667085]">Technical evidence</p>
              <h2 id="audit-trail-title" className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#0B1220]">Audit Trail</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#667085]">Friendly summaries with the original event codes, timestamps, and checkout-scoped evidence retained.</p>
              <div className="mt-6 space-y-3" aria-live="polite">
                {events === null && <p className="text-sm text-[#667085]">Loading audit evidence…</p>}
                {events?.length === 0 && <p className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-6 text-sm text-[#667085]">No audit events are available for this checkout.</p>}
                {events?.map((event) => {
                  const tone = toneFor(event.event_type);
                  const accent = tone === "err" ? "border-l-[#B42318]" : tone === "ok" ? "border-l-[#087443]" : "border-l-[#4F46E5]";
                  const code = tone === "err" ? "text-[#B42318]" : tone === "ok" ? "text-[#087443]" : "text-[#4F46E5]";
                  return (
                    <article key={event.id} className={`rounded-xl border border-[#E3E8EF] border-l-4 bg-white px-5 py-4 ${accent}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0"><h3 className="text-base font-semibold text-[#0B1220]">{friendlyEventTitle(event)}</h3><p className={`mt-1 break-all font-mono text-[11px] font-medium tracking-wide ${code}`}>{event.event_type}</p></div>
                        <time dateTime={event.created_at} className="font-mono text-[11px] text-[#667085]">{formatTimestamp(event.created_at)}</time>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-[#344054]">{eventEvidence(event)}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
