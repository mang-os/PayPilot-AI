import type { AuditEventRow, CheckoutDetail } from "./api";

export type StageState = "upcoming" | "active" | "completed" | "failed";
export type EvidenceState = { state: StageState; label: string; reason?: string };
export const TRANSACTION_STAGES = [
  { id: "intent", label: "Intent" },
  { id: "discovery", label: "Discovery" },
  { id: "selection", label: "Selection" },
  { id: "cart", label: "Cart" },
  { id: "checks", label: "Checks" },
  { id: "razorpay", label: "Razorpay" },
  { id: "complete", label: "Complete" },
] as const;
export type StageId = (typeof TRANSACTION_STAGES)[number]["id"];

export function chronologicalEvents(events: AuditEventRow[]) {
  return [...events].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

export function auditTimestamp(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
}

export function eventViolations(event: AuditEventRow | undefined) {
  const values = event?.payload?.violations;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entry = value as { code?: unknown; message?: unknown };
    return typeof entry.code === "string"
      ? [{ code: entry.code, message: typeof entry.message === "string" ? entry.message : "" }]
      : [];
  });
}

const evidence = (state: StageState, label: string, reason?: string): EvidenceState => ({ state, label, reason });

// One presentation model for Buyer progress and Merchant Execution. No clock advances it.
export function transactionEvidence(checkout: CheckoutDetail | null, events: AuditEventRow[]) {
  const ordered = chronologicalEvents(events);
  const last = (...types: string[]) => ordered.findLastIndex((event) => types.includes(event.event_type));
  const completed = last("ORDER_COMPLETED") >= 0 || checkout?.status === "COMPLETED";
  const verified = completed || last("PAYMENT_VERIFIED") > last("PAYMENT_FAILED");
  const orderCreated = Boolean(checkout?.razorpay_order_id) || last("RAZORPAY_ORDER_CREATED") >= 0;
  const attempt = ordered.findLastIndex((event) => event.event_type === "REQUEST_RECEIVED" && event.message === "Checkout complete request");
  const rejectionIndex = last("POLICY_REJECTED");
  const rejection = rejectionIndex >= 0 ? ordered[rejectionIndex] : undefined;
  const violations = eventViolations(rejection);
  const controlRejection = !completed && rejectionIndex > last("POLICY_APPROVED", "RAZORPAY_ORDER_CREATED");
  const authorityViolation = controlRejection ? violations.find((value) => value.code.startsWith("MANDATE_")) : undefined;
  const inventoryViolation = controlRejection ? violations.find((value) => value.code === "INVENTORY_UNAVAILABLE") : undefined;
  const policyViolation = controlRejection ? violations.find((value) => !value.code.startsWith("MANDATE_") && value.code !== "INVENTORY_UNAVAILABLE") : undefined;
  const authorityRejected = !completed && (Boolean(authorityViolation)
    || last("MANDATE_REJECTED", "MANDATE_EXPIRED", "MANDATE_AMOUNT_EXCEEDED") > last("MANDATE_VALIDATED", "RAZORPAY_ORDER_CREATED"));
  const inventoryRejected = !completed && (Boolean(inventoryViolation)
    || last("INVENTORY_UNAVAILABLE") > last("INVENTORY_RESERVED", "RAZORPAY_ORDER_CREATED"));
  const policyRejected = controlRejection && (Boolean(policyViolation) || violations.length === 0);
  const checksRejected = policyRejected || authorityRejected || inventoryRejected;
  const timedOut = !completed && !orderCreated && last("RAZORPAY_TIMEOUT") > Math.max(attempt, last("POLICY_APPROVED", "MANDATE_VALIDATED", "INVENTORY_RESERVED"));
  const paymentFailed = !completed && last("PAYMENT_FAILED") > last("PAYMENT_VERIFIED");
  const webhookRejected = !verified && last("WEBHOOK_SIGNATURE_INVALID") > last("PAYMENT_VERIFIED", "PAYMENT_FAILED");
  const failed = !completed && (checkout?.status === "FAILED" || last("ORDER_FAILED") >= 0);
  const released = !verified && last("INVENTORY_RESERVED") >= 0
    && last("PAYMENT_FAILED", "RAZORPAY_TIMEOUT", "ORDER_FAILED") > last("INVENTORY_RESERVED");
  const controlsPassed = !checksRejected && (orderCreated || completed);
  const policyPassed = controlsPassed || last("POLICY_APPROVED") > Math.max(rejectionIndex, attempt)
    || (controlRejection && violations.length > 0 && !policyRejected);
  const authorityPassed = controlsPassed || (!authorityRejected && last("MANDATE_VALIDATED") > Math.max(attempt, last("RAZORPAY_TIMEOUT")));
  const inventoryReserved = !released && !inventoryRejected && (controlsPassed || last("INVENTORY_RESERVED") >= 0);
  const checksStarted = attempt >= 0 || last("POLICY_APPROVED", "MANDATE_VALIDATED", "INVENTORY_RESERVED") >= 0;
  const canCheck = Boolean(checkout) && checksStarted && !checksRejected && !timedOut && !failed;

  const policy = policyRejected ? evidence("failed", "REJECTED", policyViolation?.message || rejection?.message)
    : policyPassed ? evidence("completed", "APPROVED") : evidence(canCheck ? "active" : "upcoming", canCheck ? "CHECKING" : "AWAITING");
  const authority = authorityRejected ? evidence("failed", "REJECTED", authorityViolation?.message || ordered[last("MANDATE_REJECTED", "MANDATE_EXPIRED", "MANDATE_AMOUNT_EXCEEDED")]?.message)
    : authorityPassed ? evidence("completed", "VALIDATED") : evidence(canCheck && policyPassed ? "active" : "upcoming", canCheck && policyPassed ? "VALIDATING" : "AWAITING");
  const inventory = inventoryRejected ? evidence("failed", "NOT RESERVED", inventoryViolation?.message)
    : released ? evidence("upcoming", "RELEASED")
    : inventoryReserved ? evidence("completed", verified ? "CONFIRMED" : "RESERVED")
    : checksRejected ? evidence("upcoming", "NOT RESERVED")
    : evidence(canCheck && authorityPassed ? "active" : "upcoming", canCheck && authorityPassed ? "CHECKING" : "AWAITING");
  const checksComplete = policyPassed && authorityPassed && inventoryReserved;
  const failureStage: StageId | null = checksRejected ? "checks" : timedOut || paymentFailed ? "razorpay"
    : webhookRejected ? "complete" : failed ? orderCreated ? "razorpay" : "checks" : null;
  const reason = failureStage ? [policy.reason, authority.reason, inventory.reason].filter(Boolean).join(" ")
    || ordered[last("PAYMENT_FAILED", "WEBHOOK_SIGNATURE_INVALID", "RAZORPAY_TIMEOUT", "ORDER_FAILED")]?.message
    || checkout?.failure_reason || "This purchase could not proceed." : null;
  const activeControl = policy.state === "active" ? "Checking purchase rules"
    : authority.state === "active" ? "Validating spending authority"
    : inventory.state === "active" ? "Checking inventory" : null;
  const phaseLabel = completed ? "Purchase complete" : checksRejected ? "Purchase blocked at Checks"
    : timedOut ? "Razorpay order creation failed" : paymentFailed ? "Payment failed"
    : webhookRejected ? "Payment verification rejected" : failed ? "Purchase blocked"
    : verified ? "Payment verified · recording purchase" : orderCreated ? "Awaiting payment authentication"
    : checksComplete ? "Creating Razorpay order" : activeControl || (checkout ? "Cart created · awaiting financial checks" : "Waiting for purchase details");
  return {
    policy, authority, inventory, checksComplete, checksStarted, activeControl, failureStage, reason,
    completed, verified, orderCreated, phaseLabel,
    status: completed ? "COMPLETE" : failureStage ? "BLOCKED" : orderCreated ? "AWAITING PAYMENT" : "PROCESSING",
    razorpay: checksRejected ? evidence("upcoming", "NOT INVOKED")
      : timedOut ? evidence("failed", "FAILED") : orderCreated ? evidence("completed", "CREATED")
      : evidence(checksComplete ? "active" : "upcoming", checksComplete ? "CREATING" : "AWAITING"),
    webhook: verified || paymentFailed ? evidence("completed", "VERIFIED")
      : webhookRejected ? evidence("failed", "REJECTED")
      : evidence(orderCreated ? "active" : "upcoming", checksRejected ? "NOT INVOKED" : "AWAITING"),
    payment: verified ? evidence("completed", "VERIFIED") : paymentFailed ? evidence("failed", "FAILED")
      : evidence(orderCreated ? "active" : "upcoming", checksRejected ? "NOT ATTEMPTED" : "AWAITING"),
  };
}

export type BuyerProgressInput = {
  checkout: CheckoutDetail | null;
  events: AuditEventRow[] | null;
  checkoutId?: string;
  intentSubmitted?: boolean;
  discoveryRecorded?: boolean;
  discovery?: "idle" | "searching" | "matched" | "empty" | "error";
  productSelected?: boolean;
  purchaseStarting?: boolean;
  purchaseError?: string | null;
};

export function buyerProgress(input: BuyerProgressInput) {
  const events = input.events ?? [];
  const has = (...types: string[]) => events.some((event) => types.includes(event.event_type));
  const transaction = transactionEvidence(input.checkout, events);
  const states: StageState[] = TRANSACTION_STAGES.map(() => "upcoming");
  let active = 0;
  let failure: number | null = null;
  let detail = "Tell PayPilot AI what you want to buy";
  const recordedCart = Boolean(input.checkout) || has("CHECKOUT_CREATED");
  const intentRecorded = input.intentSubmitted || events.some((event) => event.event_type === "REQUEST_RECEIVED" && event.message.startsWith("Agent query:"));
  const discoveryRecorded = input.discoveryRecorded || input.discovery === "matched" || has("PRODUCT_SEARCH");

  if (input.checkoutId && !input.checkout && input.events === null) {
    return { stages: TRANSACTION_STAGES.map((stage) => ({ ...stage, state: "upcoming" as StageState, caption: undefined as string | undefined })), detail: "Loading transaction progress", state: "upcoming" as StageState };
  }
  if (intentRecorded || input.discovery === "searching") { active = 1; detail = "Searching the merchant catalog"; }
  if (input.discovery === "matched" || has("PRODUCT_SEARCH")) { active = 2; detail = "Choose a product for this purchase"; }
  if (input.discovery === "empty") { active = -1; states[0] = "completed"; states[1] = "completed"; detail = "No matching products · update your intent to search again"; }
  if (input.discovery === "error") { failure = 1; detail = "Discovery could not complete · try again"; }
  if (input.productSelected || has("PRODUCT_SELECTED")) { active = 3; detail = "Preparing your purchase"; }
  if (input.purchaseError && !recordedCart && input.productSelected && !input.purchaseStarting) { failure = 3; detail = input.purchaseError; }
  // A persisted cart proves selection, not a historical discovery request.
  if (recordedCart) {
    active = transaction.checksComplete || transaction.orderCreated ? 5 : transaction.checksStarted ? 4 : -1;
    if (active === -1) states.fill("completed", 0, 4);
    if (transaction.verified) active = 6;
    if (transaction.completed) active = 7;
    failure = transaction.failureStage ? TRANSACTION_STAGES.findIndex((stage) => stage.id === transaction.failureStage) : null;
    detail = transaction.phaseLabel;
  }
  if (failure !== null) {
    states.fill("upcoming");
    states.fill("completed", 0, failure);
    states[failure] = "failed";
  } else if (active >= 0) {
    states.fill("completed", 0, Math.min(active, 7));
    if (active < 7) states[active] = "active";
  }
  const unrecorded = recordedCart ? [!intentRecorded ? 0 : -1, !discoveryRecorded ? 1 : -1] : [];
  for (const index of unrecorded) if (index >= 0) states[index] = "upcoming";
  return { stages: TRANSACTION_STAGES.map((stage, index) => ({ ...stage, state: states[index], caption: unrecorded.includes(index) ? "Not recorded" : undefined })), detail,
    state: failure !== null ? "failed" as StageState : active === 7 ? "completed" as StageState : active < 0 ? "upcoming" as StageState : "active" as StageState };
}
