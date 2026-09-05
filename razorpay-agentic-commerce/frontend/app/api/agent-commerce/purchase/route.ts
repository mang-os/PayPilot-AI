import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = (
  process.env.AGENT_COMMERCE_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || "http://localhost:8000"
).replace(/\/$/, "");

type UpstreamPayload = Record<string, unknown>;

async function callBackend(path: string, apiKey: string, init: RequestInit) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as UpstreamPayload;
  return { response, payload };
}

function upstreamMessage(payload: UpstreamPayload, fallback: string) {
  return typeof payload.message === "string" ? payload.message : fallback;
}

function buyerCompletionMessage(payload: UpstreamPayload) {
  if (payload.error_code !== "POLICY_VIOLATION") {
    return upstreamMessage(payload, "The purchase could not proceed to payment.");
  }
  const details = typeof payload.details === "object" && payload.details !== null
    ? payload.details as Record<string, unknown>
    : null;
  const violations = Array.isArray(details?.violations) ? details.violations : [];
  const codes = violations.flatMap((entry) => (
    typeof entry === "object" && entry !== null && typeof (entry as { code?: unknown }).code === "string"
      ? [(entry as { code: string }).code]
      : []
  ));
  if (codes.includes("MANDATE_AMOUNT_EXCEEDED")) {
    return "Spending Authority rejected this purchase because the total exceeds the amount authorized.";
  }
  if (codes.some((code) => code.startsWith("MANDATE_"))) {
    return "Spending Authority could not be validated for this purchase.";
  }
  if (codes.includes("INVENTORY_UNAVAILABLE")) {
    return "Inventory could not reserve the requested quantity.";
  }
  return "A deterministic financial control blocked this purchase.";
}

function mandateExpiry() {
  return new Date(Date.now() + 30 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

function signMandate(agentId: string, maxAmount: number, expiresAt: string, privateKeyHex: string) {
  if (!/^[a-f\d]{64}$/i.test(privateKeyHex)) {
    throw new Error("The configured agent signing key is invalid.");
  }
  const canonicalPayload = Buffer.from(
    `agent_id=${agentId}|max_amount=${maxAmount.toFixed(2)}|currency=INR|expires_at=${expiresAt}`,
    "utf8",
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(privateKeyHex, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, canonicalPayload, privateKey).toString("hex");
}

export async function POST(request: Request) {
  const apiKey = process.env.AGENT_COMMERCE_API_KEY;
  const agentId = process.env.AGENT_COMMERCE_AGENT_ID;
  const privateKeyHex = process.env.AGENT_COMMERCE_PRIVATE_KEY_HEX;
  if (!apiKey || !agentId || !privateKeyHex) {
    return NextResponse.json(
      { message: "PayPilot AI is not configured to prepare purchases." },
      { status: 503 },
    );
  }

  let productId = "";
  let offerCode: string | null = null;
  let quantity = 0;
  let mandateAmount = 0;
  try {
    const body = await request.json() as Record<string, unknown>;
    productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
    offerCode = typeof body.offer_code === "string" && body.offer_code.trim()
      ? body.offer_code.trim()
      : null;
    quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
    mandateAmount = typeof body.mandate_amount === "number"
      ? body.mandate_amount
      : Number(body.mandate_amount);
  } catch {
    return NextResponse.json({ message: "Enter valid purchase details." }, { status: 400 });
  }

  if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return NextResponse.json({ message: "Select a product and valid quantity." }, { status: 400 });
  }
  if (!Number.isFinite(mandateAmount) || mandateAmount <= 0) {
    return NextResponse.json({ message: "Enter the maximum amount you authorize for this purchase." }, { status: 400 });
  }

  let signature = "";
  const expiresAt = mandateExpiry();
  try {
    signature = signMandate(agentId, mandateAmount, expiresAt, privateKeyHex);
  } catch {
    return NextResponse.json(
      { message: "PayPilot AI could not prepare Spending Authority for this purchase." },
      { status: 503 },
    );
  }

  try {
    const created = await callBackend("/acp/checkouts", apiKey, {
      method: "POST",
      body: JSON.stringify({
        items: [{ product_id: productId, quantity }],
        offer_code: offerCode,
        idempotency_key: `buyer-ui-${randomUUID()}`,
      }),
    });
    if (!created.response.ok || typeof created.payload.checkout_id !== "string") {
      return NextResponse.json(
        { message: upstreamMessage(created.payload, "The purchase could not be prepared.") },
        { status: created.response.status >= 500 ? 503 : created.response.status },
      );
    }
    const checkoutId = created.payload.checkout_id;

    const mandate = await callBackend("/agent-commerce/mandates", apiKey, {
      method: "POST",
      body: JSON.stringify({
        agent_id: agentId,
        max_amount: mandateAmount,
        currency: "INR",
        expires_at: expiresAt,
        signature,
      }),
    });
    if (!mandate.response.ok || typeof mandate.payload.mandate_id !== "string") {
      return NextResponse.json({
        checkout_id: checkoutId,
        payment: null,
        completion_error: upstreamMessage(mandate.payload, "Spending Authority could not be created."),
      });
    }

    const updated = await callBackend(`/acp/checkouts/${encodeURIComponent(checkoutId)}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify({ mandate_id: mandate.payload.mandate_id }),
    });
    if (!updated.response.ok) {
      return NextResponse.json({
        checkout_id: checkoutId,
        payment: null,
        completion_error: upstreamMessage(updated.payload, "Spending Authority could not be attached to this purchase."),
      });
    }

    const completed = await callBackend(`/acp/checkouts/${encodeURIComponent(checkoutId)}/complete`, apiKey, {
      method: "POST",
    });
    if (!completed.response.ok) {
      return NextResponse.json({
        checkout_id: checkoutId,
        payment: null,
        completion_error: buyerCompletionMessage(completed.payload),
      });
    }

    return NextResponse.json({
      checkout_id: checkoutId,
      completion_error: null,
      payment: typeof completed.payload.razorpay_order_id === "string"
        && typeof completed.payload.razorpay_key_id === "string"
        ? {
            order_id: completed.payload.razorpay_order_id,
            key_id: completed.payload.razorpay_key_id,
            amount: completed.payload.final_amount,
            currency: completed.payload.currency,
          }
        : null,
    });
  } catch {
    return NextResponse.json(
      { message: "The purchase service is unavailable right now." },
      { status: 503 },
    );
  }
}
