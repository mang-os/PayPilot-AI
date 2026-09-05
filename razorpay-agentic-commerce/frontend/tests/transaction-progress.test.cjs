const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Exercise the actual shared TypeScript module without adding a test dependency.
const filename = path.resolve(__dirname, "../lib/transaction-progress.ts");
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { buyerProgress, transactionEvidence, chronologicalEvents, auditTimestamp } = compiled.exports;
const checkout = { checkout_id: "test-checkout", status: "CREATED", items: [{ name: "Test product", quantity: 2 }], razorpay_order_id: null };
const event = (event_type, id, extra = {}) => ({ id, event_type, created_at: `2026-09-05T12:00:${String(id).padStart(2, "0")}`, message: event_type, payload: null, ...extra });
const attempt = event("REQUEST_RECEIVED", 2, { message: "Checkout complete request" });
const controls = [event("CHECKOUT_CREATED", 1), attempt, event("POLICY_APPROVED", 3), event("MANDATE_VALIDATED", 4), event("INVENTORY_RESERVED", 5)];
const ordered = [...controls, event("RAZORPAY_ORDER_CREATED", 6)];
const states = (input) => buyerProgress({ checkout: null, events: [], ...input }).stages.map((stage) => stage.state);

test("intent, discovery, selection and cart follow actual UI state", () => {
  assert.deepEqual(states({}), ["active", ...Array(6).fill("upcoming")]);
  assert.deepEqual(states({ intentSubmitted: true, discovery: "searching" }).slice(0, 3), ["completed", "active", "upcoming"]);
  assert.deepEqual(states({ intentSubmitted: true, discovery: "matched" }).slice(0, 4), ["completed", "completed", "active", "upcoming"]);
  assert.deepEqual(states({ intentSubmitted: true, discovery: "matched", productSelected: true, purchaseStarting: true }).slice(0, 5), ["completed", "completed", "completed", "active", "upcoming"]);
});

test("no matches finish discovery without advancing to cart or payment", () => {
  assert.deepEqual(states({ intentSubmitted: true, discovery: "empty" }), ["completed", "completed", ...Array(5).fill("upcoming")]);
  assert.equal(states({ intentSubmitted: true, discovery: "error" })[1], "failed");
  assert.equal(states({ productSelected: true, purchaseError: "Request failed" })[3], "failed");
});

test("historical checkout does not invent discovery or treat checkout updates as buyer intent", () => {
  const progress = buyerProgress({ checkout, events: [event("REQUEST_RECEIVED", 1, { message: "Checkout update request" })] });
  assert.equal(progress.stages[0].caption, "Not recorded");
  assert.equal(progress.stages[1].caption, "Not recorded");
  assert.equal(progress.stages[2].state, "completed");
  assert.equal(progress.stages[3].state, "completed");
  assert.equal(progress.stages[4].state, "upcoming");
  assert.equal(transactionEvidence(checkout, []).policy.state, "upcoming");
});

test("each persisted control event selects the same active check for both views", () => {
  for (const [length, active] of [[2, "policy"], [3, "authority"], [4, "inventory"]]) {
    const events = controls.slice(0, length);
    assert.equal(transactionEvidence(checkout, events)[active].state, "active");
    assert.equal(states({ checkout, events })[4], "active");
  }
  assert.equal(transactionEvidence(checkout, controls).razorpay.state, "active");
  assert.equal(states({ checkout, events: controls })[5], "active");
});

test("all deterministic rejection categories stop at Checks", () => {
  for (const code of ["MANDATE_AMOUNT_EXCEEDED", "INVENTORY_UNAVAILABLE", "DAILY_LIMIT_EXCEEDED"]) {
    const events = [event("CHECKOUT_CREATED", 1), attempt, event("POLICY_REJECTED", 3, { payload: { violations: [{ code, message: "Recorded rejection" }] } })];
    const model = transactionEvidence({ ...checkout, status: "FAILED" }, events);
    assert.equal(model.failureStage, "checks");
    assert.equal(model.razorpay.label, "NOT INVOKED");
    assert.deepEqual(states({ checkout, events }).slice(4), ["failed", "upcoming", "upcoming"]);
    if (code === "MANDATE_AMOUNT_EXCEEDED") {
      assert.equal(model.authority.state, "failed");
      assert.equal(model.inventory.label, "NOT RESERVED");
      assert.equal(model.policy.label, "APPROVED");
    }
  }
});

test("an order and webhook receipt cannot mark payment complete", () => {
  const events = [...ordered, event("WEBHOOK_RECEIVED", 7)];
  assert.deepEqual(states({ checkout, events }).slice(5), ["active", "upcoming"]);
  assert.equal(transactionEvidence(checkout, events).payment.state, "active");
  assert.equal(transactionEvidence(checkout, events).webhook.label, "AWAITING");
});

test("verified payment activates completion; persisted completion confirms the purchase", () => {
  const events = [...ordered, event("PAYMENT_VERIFIED", 7)];
  assert.equal(states({ checkout, events })[6], "active");
  events.push(event("ORDER_COMPLETED", 8));
  assert.deepEqual(states({ checkout, events, intentSubmitted: true, discoveryRecorded: true }), Array(7).fill("completed"));
  assert.equal(transactionEvidence(checkout, events).inventory.label, "CONFIRMED");
});

test("payment failure stops at Razorpay, not Complete, and releases reserved stock", () => {
  const events = [...ordered, event("PAYMENT_FAILED", 7), event("ORDER_FAILED", 8)];
  assert.deepEqual(states({ checkout, events }).slice(5), ["failed", "upcoming"]);
  assert.equal(transactionEvidence(checkout, events).inventory.label, "RELEASED");
  assert.equal(transactionEvidence(checkout, events).webhook.label, "VERIFIED");
});

test("repricing failure before reservation does not invent released inventory", () => {
  const events = [event("CHECKOUT_CREATED", 1), attempt, event("ORDER_FAILED", 3)];
  const model = transactionEvidence({ ...checkout, status: "FAILED" }, events);
  assert.equal(model.failureStage, "checks");
  assert.notEqual(model.inventory.label, "RELEASED");
});

test("timeout stops at Razorpay and fresh retry evidence supersedes that failure", () => {
  const events = [...controls, event("RAZORPAY_TIMEOUT", 6)];
  assert.equal(transactionEvidence(checkout, events).failureStage, "razorpay");
  assert.equal(transactionEvidence(checkout, events).inventory.label, "RELEASED");
  events.push(event("REQUEST_RECEIVED", 7, { message: "Checkout complete request" }));
  assert.equal(transactionEvidence(checkout, events).failureStage, null);
  assert.equal(transactionEvidence(checkout, events).policy.state, "active");
  events.push(event("POLICY_APPROVED", 8), event("MANDATE_VALIDATED", 9), event("INVENTORY_RESERVED", 10));
  assert.equal(transactionEvidence(checkout, events).inventory.label, "RESERVED");
  assert.equal(transactionEvidence(checkout, events).razorpay.state, "active");
});

test("later success supersedes webhook failure and old rejected controls", () => {
  const events = [event("MANDATE_REJECTED", 0), ...ordered, event("WEBHOOK_SIGNATURE_INVALID", 7), event("PAYMENT_VERIFIED", 8), event("ORDER_COMPLETED", 9)];
  const model = transactionEvidence({ ...checkout, status: "COMPLETED" }, events);
  assert.equal(model.failureStage, null);
  assert.equal(model.authority.label, "VALIDATED");
  assert.equal(model.webhook.label, "VERIFIED");
});

test("events are ordered deterministically without mutating the API response", () => {
  const shuffled = [ordered[5], ordered[1], ordered[0]];
  const before = shuffled.map((value) => value.id);
  assert.deepEqual(chronologicalEvents(shuffled).map((value) => value.id), [1, 2, 6]);
  assert.deepEqual(shuffled.map((value) => value.id), before);
});

test("persisted completion takes precedence over a separate catalog load failure", () => {
  const stages = states({ checkout: { ...checkout, status: "COMPLETED" }, events: ordered, discovery: "error", intentSubmitted: true, discoveryRecorded: true });
  assert.deepEqual(stages, Array(7).fill("completed"));
});

test("audit timestamps interpret timezone-less backend values as UTC", () => {
  assert.equal(auditTimestamp("2026-09-05T16:05:13.123"), "2026-09-05T16:05:13.123Z");
  assert.equal(auditTimestamp("2026-09-05T16:05:13Z"), "2026-09-05T16:05:13Z");
  assert.equal(auditTimestamp("2026-09-05T16:05:13+05:30"), "2026-09-05T16:05:13+05:30");
});
