"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import CommerceCart from "@/components/commerce/CommerceCart";
import TransactionProgress from "@/components/commerce/TransactionProgress";
import ProductVisual from "@/components/commerce/ProductVisual";
import { transactionEvidence, chronologicalEvents, eventViolations, type EvidenceState } from "@/lib/transaction-progress";
import { api, formatINR, type AgentQueryResponse, type AuditEventRow, type CatalogProduct, type CatalogResponse, type CheckoutDetail, type PurchasePayment } from "@/lib/api";
import s from "@/components/commerce/BuyerCommerce.module.css";

type DiscoveryPhase = "loading" | "ready" | "searching" | "results" | "error";
type EvidenceTone = "approved" | "blocked" | "pending";
type EvidenceStatus = { label: string; tone: EvidenceTone };

const EXAMPLE_INTENT = "Find me 2 ANC earbuds under ₹6,000";

type RazorpayCheckout = {
  open: () => void;
  on: (event: string, handler: () => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function categoryLabel(category: string) {
  return category.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function purchaseDefaults(intent: string) {
  const quantityMatch = intent.match(/\b(?:find|buy|get|order)(?:\s+me)?\s+(\d+)\b/i);
  const budgetMatch = intent.match(/(?:under|below|within|less than)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i)
    ?? intent.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  const parsedQuantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  return {
    quantity: Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
    mandateAmount: budgetMatch ? budgetMatch[1].replace(/,/g, "") : "",
  };
}

function loadRazorpayCheckout(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
  return new Promise((resolve) => {
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    if (!existing) {
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

function replacePurchaseUrl(checkoutId: string, purchaseIntent: string) {
  const url = new URL(window.location.href);
  if (checkoutId) url.searchParams.set("checkout", checkoutId);
  else url.searchParams.delete("checkout");
  if (checkoutId && purchaseIntent) url.searchParams.set("intent", purchaseIntent);
  else url.searchParams.delete("intent");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function rememberBuyerContext(checkoutId: string, purchaseIntent: string, result: AgentQueryResponse) {
  try {
    window.sessionStorage.setItem(`paypilot:checkout:${checkoutId}`, JSON.stringify({
      intent: purchaseIntent,
      matchedProducts: result.matched_products.map((product) => product.name),
      rationale: result.rationale,
      offer: result.suggested_offer
        ? { code: result.suggested_offer.code, description: result.suggested_offer.description }
        : null,
    }));
  } catch {
    // The persisted checkout remains authoritative when browser storage is unavailable.
  }
}

function buyerEvidence(value: EvidenceState): EvidenceStatus {
  return { label: value.label, tone: value.state === "completed" ? "approved" : value.state === "failed" ? "blocked" : "pending" };
}


function SectionHeading({ number, title, id, children }: { number: string; title: string; id?: string; children?: ReactNode }) {
  return (
    <div className={s.sectionHeading}>
      <span className={s.sectionNumber} aria-hidden="true">{number}</span>
      <div><h2 id={id}>{title}</h2>{children}</div>
    </div>
  );
}

function Status({ value }: { value: EvidenceStatus }) {
  return <span className={s.status} data-tone={value.tone}>{value.label}</span>;
}

function ProductFacts({ product }: { product: CatalogProduct }) {
  return (
    <>
      <p className={s.productFacts}>{product.description || categoryLabel(product.category)}</p>
      <p className={s.stock}>
        <span className={s.stockDot} aria-hidden="true" />
        {product.inventory === null ? "Availability not listed"
          : product.inventory.quantity_available > 0 ? String(product.inventory.quantity_available) + " currently available"
          : "Currently unavailable"}
      </p>
    </>
  );
}

function CandidateCard({ product, disabled, selected, recommended, onSelect }: {
  product: CatalogProduct;
  disabled?: boolean;
  selected?: boolean;
  recommended?: boolean;
  onSelect?: () => void;
}) {
  return (
    <article className={s.productCard} data-selected={selected || undefined} data-recommended={recommended || undefined}>
      <div className={s.productImage}><ProductVisual product={product} presentation="buyer" /></div>
      <div className={s.productBody}>
        <div className={s.productMeta}>
          <span>{categoryLabel(product.category)}</span>
          <span className={s.recommendationLabel}>
            {selected ? "Chosen for purchase" : recommended ? "PayPilot AI recommendation" : "Other product considered"}
          </span>
        </div>
        <h3>{product.name}</h3>
        <p className={s.productPrice}>{formatINR(product.price)} <span>each</span></p>
        <ProductFacts product={product} />
        {onSelect && (
          <button type="button" className={s.purchaseButton} disabled={disabled} onClick={onSelect}>
            {selected ? "Chosen for purchase" : recommended ? "Choose recommendation" : "Choose this product"}
          </button>
        )}
      </div>
    </article>
  );
}

type PolicyViolation = { code: string; message?: string };

function violationControl(violation: PolicyViolation) {
  if (violation.code.startsWith("MANDATE_")) return "Spending Authority";
  if (violation.code === "INVENTORY_UNAVAILABLE") return "Inventory";
  return "Policy";
}

function violationReason(violation: PolicyViolation) {
  switch (violation.code) {
    case "MANDATE_AMOUNT_EXCEEDED":
      return violation.message || "The purchase total exceeds the maximum amount you authorized.";
    case "MANDATE_EXPIRED":
      return "The Spending Authority expired before this purchase could be approved.";
    case "MANDATE_MISSING":
      return "No Spending Authority was attached to this purchase.";
    case "MANDATE_INVALID":
      return "The Spending Authority could not be validated.";
    case "INVENTORY_UNAVAILABLE":
      return violation.message || "The requested quantity is not available.";
    case "TRANSACTION_LIMIT_EXCEEDED":
      return "This purchase exceeds the permitted transaction limit.";
    case "DAILY_LIMIT_EXCEEDED":
      return "This purchase exceeds the permitted daily spending limit.";
    case "AGENT_NOT_ACTIVE":
      return "PayPilot AI is not authorized to make this purchase.";
    default:
      return "A purchase rule did not approve this request.";
  }
}

function Gate({ index, title, detail, status, children }: {
  index: string; title: string; detail: string; status: EvidenceStatus; children?: ReactNode;
}) {
  return (
    <li className={s.gate}>
      <span className={s.gateNumber} data-tone={status.tone} aria-hidden="true">
        {status.tone === "approved" ? "✓" : status.tone === "blocked" ? "!" : index}
      </span>
      <div className={s.gateContent}>
        <div className={s.gateTitle}><h3>{title}</h3><Status value={status} /></div>
        <p>{detail}</p>
        {children}
      </div>
    </li>
  );
}

function PurchaseStages({ checkout, events, detailsHref, paymentOrder, onPay }: {
  checkout: CheckoutDetail | null;
  events: AuditEventRow[] | null;
  detailsHref: string;
  paymentOrder: PurchasePayment | null;
  onPay: () => void;
}) {
  const trace = events ?? [];
  const model = transactionEvidence(checkout, trace);
  const violations = model.failureStage === "checks" ? eventViolations(chronologicalEvents(trace).findLast((event) => event.event_type === "POLICY_REJECTED")) : [];
  const mandateViolation = violations.find((violation) => violation.code.startsWith("MANDATE_"));
  const inventoryViolation = violations.find((violation) => violation.code === "INVENTORY_UNAVAILABLE");
  const policy = buyerEvidence(model.policy);
  const authority = buyerEvidence(model.authority);
  const inventory = buyerEvidence(model.inventory);
  const razorpay = buyerEvidence(model.razorpay);
  const payment = buyerEvidence(model.webhook.state === "failed" ? model.webhook : model.payment);
  const completion: EvidenceStatus = model.completed ? { label: "COMPLETE", tone: "approved" }
    : model.failureStage ? { label: "BLOCKED", tone: "blocked" } : { label: "AWAITING", tone: "pending" };
  const noRazorpayOrder = !model.orderCreated;
  const blockedBeforePayment = model.failureStage === "checks";
  const checksApproved = model.checksComplete;
  const razorpayDisplay = razorpay;
  const paymentDisplay = payment;
  const quantity = checkout?.items.reduce((total, item) => total + item.quantity, 0) ?? 0;
  const fallbackBlockedControl = payment.tone === "blocked"
    ? "Payment Verification"
    : razorpay.tone === "blocked" ? "Razorpay" : "Policy";
  const fallbackBlockedReason = model.reason || (payment.tone === "blocked"
    ? "Payment could not be verified by the backend."
    : razorpay.tone === "blocked"
      ? "Razorpay order creation could not be completed."
      : "A purchase rule did not approve this request.");

  return (
    <>
      <section id="checks" className={s.checksSection} aria-labelledby="checks-heading">
        <div className={s.trustBoundary} aria-label="PayPilot AI decision enters the Financial Trust Boundary">
          <div className={s.decisionNode}>
            <span>PayPilot AI</span>
            <strong>AI Decision</strong>
            <p>Purchase requested</p>
          </div>
          <span className={s.boundaryArrow} aria-hidden="true">↓</span>
          <div className={s.boundaryNode}>
            <strong>Financial Trust Boundary</strong>
            <p>Deterministic approval required</p>
          </div>
        </div>
        <SectionHeading number="05" title="Checks before payment" id="checks-heading">
          <p>PayPilot AI can request the purchase. These deterministic controls decide whether payment is allowed.</p>
        </SectionHeading>
        <ol className={s.gates}>
          <Gate index="1" title="Policy" status={policy}
            detail={policy.tone === "approved" ? "Purchase rules passed."
              : policy.tone === "blocked" ? "A purchase rule rejected this request."
              : model.policy.state === "active" ? "Checking purchase rules." : "Awaiting purchase rule checks."} />
          <Gate index="2" title="Spending Authority" status={authority}
            detail={authority.tone === "approved" ? "The authorized spend is valid for this purchase."
              : authority.tone === "blocked" ? mandateViolation ? violationReason(mandateViolation) : "The Spending Authority was rejected."
              : model.authority.state === "active" ? "Validating the maximum amount you authorized." : "Awaiting spending authority validation."}>
            {checkout?.mandate && (
              <dl className={s.amountComparison}>
                <div><dt>Requested</dt><dd>{formatINR(checkout.final_amount)}</dd></div>
                <div><dt>Authorized</dt><dd>{formatINR(checkout.mandate.max_amount)}</dd></div>
              </dl>
            )}
          </Gate>
          <Gate index="3" title="Inventory" status={inventory}
            detail={inventory.tone === "approved" ? String(quantity) + " item" + (quantity === 1 ? "" : "s") + (model.verified ? " confirmed for this purchase." : " reserved for this purchase.")
              : inventory.tone === "blocked" ? inventoryViolation ? violationReason(inventoryViolation) : "The requested quantity could not be reserved."
              : inventory.label === "NOT RESERVED" ? "No stock was reserved because another control stopped the purchase."
              : inventory.label === "RELEASED" ? "The inventory reservation was released."
              : model.inventory.state === "active" ? "Checking inventory before payment." : "Awaiting inventory checks."} />
        </ol>
        <div className={s.gateOutcome} data-tone={blockedBeforePayment ? "blocked" : checksApproved ? "approved" : "pending"}>
          <span>{blockedBeforePayment ? "Payment blocked" : checksApproved ? "All checks approved" : "Payment waits for all three checks"}</span>
          <span aria-hidden="true">↓</span>
        </div>
      </section>

      <section id="payment" className={s.paymentSection} aria-labelledby="payment-heading">
        <div>
          <SectionHeading number="06" title="Pay through Razorpay" id="payment-heading">
            <p>Razorpay executes payment only after financial approval.</p>
          </SectionHeading>
          <p className={s.paymentAmount}>{payment.tone === "approved" && checkout
            ? formatINR(checkout.final_amount) + " verified"
            : blockedBeforePayment ? "₹0 moved"
              : model.failureStage ? model.phaseLabel
              : noRazorpayOrder ? "Waiting for financial approval" : "Awaiting payment authentication"}</p>
        </div>
        <div className={s.paymentStates}>
          <div>
            <span>{blockedBeforePayment ? "Razorpay not invoked on this attempt"
              : razorpay.tone === "blocked" ? "Razorpay order creation"
              : "Razorpay order"}</span>
            <Status value={razorpayDisplay} />
          </div>
          <p>{blockedBeforePayment ? "This attempt stopped before a payment order was created."
            : razorpay.tone === "blocked" ? "Razorpay order creation failed. Payment was not attempted."
            : noRazorpayOrder ? "Waiting for financial approval."
            : "Razorpay order created."}</p>
          <div><span>Payment Verification</span><Status value={paymentDisplay} /></div>
          <p>{paymentDisplay.label === "NOT ATTEMPTED" ? "Payment not attempted."
            : payment.tone === "approved" ? "Payment verified by the backend webhook."
            : payment.tone === "blocked" ? "Payment could not be verified."
            : noRazorpayOrder ? "Waiting for the financial controls above."
              : "Awaiting payment authentication."}</p>
          {paymentOrder && payment.tone === "pending" && (
            <button type="button" className={s.razorpayButton} onClick={onPay}>Continue to Razorpay</button>
          )}
        </div>
      </section>

      <section id="complete" className={s.completion} data-complete={completion.tone === "approved" || undefined}
        data-blocked={completion.tone === "blocked" || undefined} aria-live="polite">
        <span className={s.completionMark} aria-hidden="true">{completion.tone === "approved" ? "✓" : "07"}</span>
        <div>
          <h2>{completion.tone === "approved" ? "Purchase Complete" : completion.tone === "blocked" ? "Purchase Blocked" : "Purchase completion"}</h2>
          {completion.tone === "approved" && checkout ? (
            <>
              <p>{checkout.items.map((item) => item.name + " × " + item.quantity).join(" · ")}</p>
              <p className={s.completionTotal}>{formatINR(checkout.final_amount)}
                <span>Paid through Razorpay</span>
              </p>
              <ul className={s.completionEvidence}>
                <li>Payment verified</li>
                <li>Inventory confirmed</li>
                <li>Transaction recorded</li>
              </ul>
            </>
          ) : completion.tone === "blocked" ? (
            <>
              <div className={s.blockedReasons}>
                {violations.length > 0 ? violations.map((violation, index) => (
                  <div key={violation.code + index}>
                    <strong>{violationControl(violation)}</strong>
                    <p>{violationReason(violation)}</p>
                    {violation.code === "MANDATE_AMOUNT_EXCEEDED" && checkout?.mandate && (
                      <dl className={s.amountComparison}>
                        <div><dt>Requested</dt><dd>{formatINR(checkout.final_amount)}</dd></div>
                        <div><dt>Authorized</dt><dd>{formatINR(checkout.mandate.max_amount)}</dd></div>
                      </dl>
                    )}
                  </div>
                )) : (
                  <div><strong>{fallbackBlockedControl}</strong><p>{fallbackBlockedReason}</p></div>
                )}
              </div>
              {blockedBeforePayment && (
                <ul className={s.blockedProof}>
                  <li>Razorpay not invoked on this attempt</li>
                  <li>Payment not attempted</li>
                  <li>₹0 moved</li>
                </ul>
              )}
            </>
          ) : <p>Your confirmation appears here after backend payment verification.</p>}
        </div>
        {checkout && <Link href={detailsHref} className={s.textLink}>View transaction in Merchant Control <span aria-hidden="true">→</span></Link>}
      </section>
    </>
  );
}

export default function BuyerCommercePage() {
  const [intent, setIntent] = useState(EXAMPLE_INTENT);
  const [submittedIntent, setSubmittedIntent] = useState("");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [discovery, setDiscovery] = useState<AgentQueryResponse | null>(null);
  const [restoredDiscovery, setRestoredDiscovery] = useState(false);
  const [phase, setPhase] = useState<DiscoveryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [currentCheckoutId, setCurrentCheckoutId] = useState("");
  const [checkoutDetail, setCheckoutDetail] = useState<CheckoutDetail | null>(null);
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseStarting, setPurchaseStarting] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [mandateAmount, setMandateAmount] = useState("");
  const [payment, setPayment] = useState<PurchasePayment | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const discoveryRequest = useRef(0);
  const purchaseRequest = useRef(0);
  const purchaseInFlight = useRef(false);

  const candidates = useMemo<CatalogProduct[]>(() => {
    if (phase !== "results" || !discovery) return [];
    return discovery.matched_products.map((product) => ({
      ...product,
      inventory: catalog?.products.find((entry) => entry.id === product.id)?.inventory ?? null,
    }));
  }, [catalog, discovery, phase]);
  const isDiscovering = phase === "loading" || phase === "searching";
  const contextIntent = submittedIntent;
  const detailsHref = currentCheckoutId
    ? "/agent-trace?checkout=" + encodeURIComponent(currentCheckoutId)
      + (contextIntent ? "&intent=" + encodeURIComponent(contextIntent) : "")
    : "/agent-trace";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const explicitCheckout = params.get("checkout")?.trim() ?? "";
    if (!explicitCheckout) return;
    let savedIntent = "";
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(`paypilot:checkout:${explicitCheckout}`) || "null");
      savedIntent = typeof stored?.intent === "string" ? stored.intent : "";
      setRestoredDiscovery(Array.isArray(stored?.matchedProducts) && stored.matchedProducts.length > 0);
    } catch { /* Missing browser context does not change persisted checkout evidence. */ }
    const explicitIntent = params.get("intent")?.trim() || savedIntent;
    setCurrentCheckoutId(explicitCheckout);
    setPurchaseLoading(true);
    if (explicitIntent) {
      setIntent(explicitIntent);
      setSubmittedIntent(explicitIntent);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.catalog().then((data) => {
      if (cancelled) return;
      setCatalog(data);
      setPhase((current) => current === "loading" ? "ready" : current);
    }).catch(() => {
      if (cancelled) return;
      setPhase((current) => {
        if (current === "loading") {
          setError("Products are unavailable right now. Try searching again in a moment.");
          return "error";
        }
        return current;
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentCheckoutId) return;
    let cancelled = false;
    let inFlight = false;
    setCheckoutDetail(null);
    setEvents(null);

    async function loadTransactionEvidence() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [detail, trace] = await Promise.all([api.checkoutDetail(currentCheckoutId), api.agentTrace(currentCheckoutId)]);
        if (cancelled) return;
        setCheckoutDetail(detail);
        setEvents(trace);
        setPurchaseLoading(false);
      } catch {
        if (!cancelled) {
          setPurchaseLoading(false);
          setTransactionError("We couldn’t refresh your purchase. The last available details are shown.");
        }
      } finally {
        inFlight = false;
      }
    }
    void loadTransactionEvidence();
    const interval = window.setInterval(loadTransactionEvidence, 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [currentCheckoutId]);

  async function startDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (purchaseInFlight.current) return;
    const nextIntent = intent.trim();
    if (!nextIntent) {
      setInputError("Tell us what you’d like to find.");
      return;
    }
    const requestId = ++discoveryRequest.current;
    purchaseRequest.current += 1;
    const defaults = purchaseDefaults(nextIntent);
    replacePurchaseUrl("", "");
    setInputError(null);
    setError(null);
    setDiscovery(null);
    setRestoredDiscovery(false);
    setSubmittedIntent(nextIntent);
    setCurrentCheckoutId("");
    setCheckoutDetail(null);
    setEvents(null);
    setTransactionError(null);
    setSelectedProductId("");
    setPayment(null);
    setPaymentNotice(null);
    setPurchaseLoading(false);
    setQuantity(defaults.quantity);
    setMandateAmount(defaults.mandateAmount);
    setPhase("searching");
    try {
      const data = await api.agentQuery(nextIntent);
      if (requestId !== discoveryRequest.current) return;
      setDiscovery(data);
      setPhase("results");
    } catch (caught) {
      if (requestId !== discoveryRequest.current) return;
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "PayPilot AI could not complete this search.");
    }
  }

  async function startPurchase(productId: string) {
    if (purchaseInFlight.current) return;
    const authorizedAmount = Number(mandateAmount);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setTransactionError("Enter a valid quantity before preparing the purchase.");
      return;
    }
    if (!Number.isFinite(authorizedAmount) || authorizedAmount <= 0) {
      setTransactionError("Enter the maximum amount you authorize for this purchase.");
      return;
    }

    const requestId = ++purchaseRequest.current;
    purchaseInFlight.current = true;
    setPurchaseStarting(true);
    setSelectedProductId(productId);
    setTransactionError(null);
    setPayment(null);
    setPaymentNotice(null);
    try {
      const result = await api.startPurchase({
        product_id: productId,
        quantity,
        offer_code: discovery?.suggested_offer?.code ?? null,
        mandate_amount: authorizedAmount,
      });
      if (requestId !== purchaseRequest.current) return;
      if (discovery) rememberBuyerContext(result.checkout_id, submittedIntent || intent.trim(), discovery);
      setCurrentCheckoutId(result.checkout_id);
      replacePurchaseUrl(result.checkout_id, submittedIntent || intent.trim());
      setPayment(result.payment);
      setPurchaseLoading(true);
      setTransactionError(result.completion_error);
    } catch (caught) {
      if (requestId !== purchaseRequest.current) return;
      setTransactionError(caught instanceof Error ? caught.message : "The purchase could not be started.");
    } finally {
      purchaseInFlight.current = false;
      if (requestId === purchaseRequest.current) setPurchaseStarting(false);
    }
  }

  async function launchPayment() {
    if (!payment) return;
    if (payment.key_id === "rzp_test_MOCKMODE") {
      setPaymentNotice("A test Razorpay order was created. The purchase completes only after a verified test webhook.");
      return;
    }
    setPaymentNotice("Opening Razorpay Checkout…");
    const ready = await loadRazorpayCheckout();
    if (!ready || !window.Razorpay) {
      setPaymentNotice("Razorpay Checkout could not be loaded. Your order remains safely pending.");
      return;
    }
    const checkout = new window.Razorpay({
      key: payment.key_id,
      order_id: payment.order_id,
      amount: Math.round(payment.amount * 100),
      currency: payment.currency,
      name: "PayPilot AI",
      description: "Purchase with deterministic financial controls",
      handler: () => setPaymentNotice("Payment submitted. Waiting for the verified Razorpay webhook before marking it complete."),
      modal: {
        ondismiss: () => setPaymentNotice("Razorpay Checkout was closed. The order remains pending."),
      },
    });
    checkout.on("payment.failed", () => {
      setPaymentNotice("Razorpay reported a failed payment. Waiting for verified webhook evidence.");
    });
    checkout.open();
  }

  return (
    <div className={s.page}>
      <div className={s.container}>
        <section id="intent" className={s.intentSection} aria-labelledby="intent-title">
          <div className={s.eyebrow}>Buyer</div>
          <h1 id="intent-title">What would you like PayPilot AI to buy?</h1>
          <p className={s.intro}>Describe the purchase. PayPilot AI will discover options and prepare your request for financial approval.</p>
          <form className={s.composer} onSubmit={startDiscovery}>
            <label className="sr-only" htmlFor="buyer-intent">What would you like PayPilot AI to buy?</label>
            <span className={s.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            </span>
            <input id="buyer-intent" value={intent} onChange={(event) => { setIntent(event.target.value); setInputError(null); }}
              placeholder={EXAMPLE_INTENT} aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "intent-error" : "search-note"} />
            <button type="submit" disabled={isDiscovering || purchaseStarting} className={s.primaryButton}>
              {phase === "searching" ? "Finding products…" : "Start shopping"} <span aria-hidden="true">→</span>
            </button>
          </form>
          {inputError && <p id="intent-error" role="alert" className={s.error}>{inputError}</p>}
          <p id="search-note" className={s.searchNote}>AI decides what commerce action to request. Deterministic controls decide whether money may move.</p>
        </section>

        <TransactionProgress
          checkout={checkoutDetail}
          checkoutId={currentCheckoutId}
          events={events}
          intentSubmitted={Boolean(submittedIntent)}
          discovery={phase === "searching" ? "searching" : phase === "error" && submittedIntent ? "error" : discovery ? discovery.matched_products.length ? "matched" : "empty" : "idle"}
          discoveryRecorded={restoredDiscovery}
          productSelected={Boolean(selectedProductId)}
          purchaseStarting={purchaseStarting}
          purchaseError={transactionError}
        />

        <section id="discovery" className={s.discovery} aria-labelledby="discovery-title" aria-busy={isDiscovering}>
          <div className={s.sectionTop}>
            <SectionHeading number="02" title="Discovery" id="discovery-title">
              <p>{submittedIntent ? "Results from the live merchant catalog" : "PayPilot AI searches after you submit an intent"}</p>
            </SectionHeading>
            <p className={s.discoveryStatus} role="status">
              <span className={s.activityDot} data-loading={isDiscovering || undefined} aria-hidden="true" />
              {isDiscovering ? phase === "searching" ? "PayPilot AI is searching the merchant catalog…" : "Preparing PayPilot AI…"
                : phase === "error" ? "Search unavailable"
                : discovery ? discovery.matched_products.length === 1 ? "1 product matched" : `${discovery.matched_products.length} products matched`
                  : currentCheckoutId ? "Current purchase ready" : "Ready for your intent"}
            </p>
          </div>
          {error && <p role="alert" className={s.error}>{error}</p>}
          {submittedIntent && <p className={s.queryCaption}>For “{submittedIntent}”</p>}
          {discovery && (
            <div className={s.agentResult}>
              <div><span>{discovery.matched_products.length > 0 ? "Why PayPilot AI recommends it" : "Search summary"}</span><p>{discovery.rationale}</p></div>
              <div><span>Offer found</span><p>{discovery.suggested_offer
                ? <><strong>{discovery.suggested_offer.code}</strong> · {discovery.suggested_offer.description}</>
                : "No applicable offer was found."}</p></div>
            </div>
          )}
          {discovery && discovery.matched_products.length > 0 && !currentCheckoutId && (
            <div className={s.purchaseSetup}>
              <div>
                <label htmlFor="purchase-quantity">Quantity</label>
                <input id="purchase-quantity" type="number" min="1" max="100" step="1" value={quantity}
                  disabled={purchaseStarting}
                  onChange={(event) => setQuantity(Number(event.target.value))} />
              </div>
              <div>
                <label htmlFor="mandate-amount">Maximum authorized spend</label>
                <div className={s.amountInput}><span>₹</span><input id="mandate-amount" type="number" min="0.01" step="0.01"
                  value={mandateAmount} disabled={purchaseStarting}
                  onChange={(event) => setMandateAmount(event.target.value)} /></div>
              </div>
              <p>PayPilot AI reads quantity and authorized spend from your intent when present. Confirm both before choosing a product.</p>
            </div>
          )}
          {transactionError && !currentCheckoutId && <p role="alert" className={s.error}>{transactionError}</p>}
          <div className={s.productGrid}>
            {isDiscovering ? [0, 1, 2].map((index) => (
              <div key={index} className={s.productSkeleton} aria-hidden="true"><div /><span /><span /></div>
            )) : candidates.map((product, index) => (
              <CandidateCard key={product.id} product={product}
                recommended={index === 0}
                disabled={purchaseStarting || Boolean(currentCheckoutId)}
                selected={selectedProductId === product.id && (purchaseStarting || Boolean(currentCheckoutId))}
                onSelect={discovery ? () => { void startPurchase(product.id); } : undefined} />
            ))}
          </div>
          {!isDiscovering && !error && candidates.length === 0 && (
            <div className={s.emptyCatalog}><h3>{discovery ? "No matching products" : currentCheckoutId ? "Your current purchase is shown below" : "Tell PayPilot AI what to find"}</h3>
              <p>{discovery ? "PayPilot AI found no products that satisfy this request. Try adjusting the product or budget." : currentCheckoutId ? "The exact purchase and its current status have been restored." : "Submit a purchase intent to search the live merchant catalog."}</p></div>
          )}
        </section>

        {currentCheckoutId && (
          <>
            <div className={s.purchaseContext}>
              <div><span className={s.eyebrow}>AI Decision</span>
                <p>{checkoutDetail ? "PayPilot AI prepared this purchase using the selected product and authorized spend."
                  : purchaseLoading ? "Preparing your purchase…" : "PayPilot AI is preparing your purchase…"}</p></div>
              {checkoutDetail && <Link href={detailsHref} className={s.textLink}>View in Merchant Control <span aria-hidden="true">→</span></Link>}
            </div>
            {transactionError && <p role="alert" className={s.error}>{transactionError}</p>}
            {paymentNotice && <p role="status" className={s.paymentNotice}>{paymentNotice}</p>}

            <div className={s.purchaseGrid}>
              <section id="selection" className={s.selection} aria-labelledby="selection-title">
                <SectionHeading number="03" title="Selection" id="selection-title" />
                {checkoutDetail?.items.length ? (
                  <div className={s.selectedProducts}>
                    {checkoutDetail.items.map((item) => {
                      const product = catalog?.products.find((entry) => entry.id === item.product_id);
                      return (
                        <article key={item.product_id} className={s.selectedProduct}>
                          <span className={s.selectedLabel}>Chosen for this purchase</span>
                          <div className={s.selectedOverview}>
                            {product && <div className={s.selectedImage}><ProductVisual product={product} presentation="buyer" /></div>}
                            <div><h3>{item.name}</h3>
                              <p className={s.selectedPrice}>{formatINR(item.unit_price)} <span>× {item.quantity}</span></p></div>
                          </div>
                          {product && <div className={s.selectedFacts}><p className={s.factLabel}>Product details</p><ProductFacts product={product} /></div>}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className={s.waitingSelection}><span className={s.selectionOutline} aria-hidden="true">—</span>
                    <h3>Loading your chosen items</h3>
                    <p>The chosen product will appear here when your purchase is ready.</p>
                  </div>
                )}
              </section>
              <section id="cart" className={s.cartSection} aria-label="Your purchase">
                <p className={s.cartStep}>04 / Your purchase</p>
                <CommerceCart checkout={checkoutDetail} presentation="buyer" onFocusJourney={() => { window.location.href = detailsHref; }} />
              </section>
            </div>

            <PurchaseStages checkout={checkoutDetail} events={events} detailsHref={detailsHref}
              paymentOrder={payment} onPay={() => { void launchPayment(); }} />
          </>
        )}
        <footer className={s.footer}><span>PayPilot AI</span><Link href={detailsHref}>{currentCheckoutId ? "View transaction in Merchant Control" : "Open Merchant Control"} <span aria-hidden="true">→</span></Link></footer>
      </div>
    </div>
  );
}
