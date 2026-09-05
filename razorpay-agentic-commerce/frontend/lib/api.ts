const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type TransactionRow = {
  order_id: string;
  checkout_id: string;
  agent_id: string;
  final_amount: number;
  currency: string;
  status: string;
  razorpay_payment_id: string | null;
  transaction_status: string | null;
  created_at: string;
};

export type CheckoutRow = {
  checkout_id: string;
  agent_id: string;
  status: string;
  final_amount: number | null;
  created_at: string;
};

export type CatalogInventory = {
  quantity_available: number;
  reserved_quantity: number;
};

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string;
  inventory: CatalogInventory | null;
};

export type OfferRow = {
  code: string;
  description: string;
  discount_type: string;
  discount_value: number;
  min_cart_amount: number;
  max_discount_amount: number | null;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
};

export type CatalogResponse = {
  products: CatalogProduct[];
  offers: OfferRow[];
};

export type AgentProduct = Omit<CatalogProduct, "inventory"> & {
  is_active: boolean;
};

export type AgentQueryResponse = {
  matched_products: AgentProduct[];
  suggested_offer: OfferRow | null;
  rationale: string;
  note: string;
};

export type PurchasePayment = {
  order_id: string;
  key_id: string;
  amount: number;
  currency: string;
};

export type PurchaseRunResponse = {
  checkout_id: string;
  payment: PurchasePayment | null;
  completion_error: string | null;
};

export type MandateSummary = {
  mandate_id: string;
  max_amount: number;
  currency: string;
  expires_at: string;
  status: string;
};

export type CheckoutDetail = {
  checkout_id: string;
  agent_id: string;
  status: string;
  items: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
  }[];
  offer_code: string | null;
  subtotal: number | null;
  discount_amount: number | null;
  tax_amount: number | null;
  final_amount: number | null;
  currency: string;
  razorpay_order_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  mandate: MandateSummary | null;
};

export type AuditEventRow = {
  id: number;
  event_type: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  checkout_id?: string | null;
  agent_id?: string | null;
};

export type FailuresResponse = {
  failure_events: AuditEventRow[];
  failed_checkouts: {
    checkout_id: string;
    agent_id: string;
    failure_reason: string | null;
    final_amount: number | null;
    updated_at: string;
  }[];
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${path} responded ${res.status}`);
  }
  return res.json();
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await res.json().catch(() => null) as { message?: unknown } | null;
  if (!res.ok) {
    throw new Error(
      typeof payload?.message === "string" ? payload.message : "The request could not be completed.",
    );
  }
  return payload as T;
}

export const api = {
  agentQuery: (query: string) => postJSON<AgentQueryResponse>("/api/agent-commerce/query", { query }),
  startPurchase: (input: {
    product_id: string;
    quantity: number;
    offer_code: string | null;
    mandate_amount: number;
  }) => postJSON<PurchaseRunResponse>("/api/agent-commerce/purchase", input),
  catalog: () => getJSON<CatalogResponse>("/dashboard/catalog"),
  transactions: () => getJSON<TransactionRow[]>("/dashboard/transactions"),
  checkouts: () => getJSON<CheckoutRow[]>("/dashboard/checkouts"),
  checkoutDetail: (checkoutId: string) => getJSON<CheckoutDetail>(`/dashboard/checkouts/${encodeURIComponent(checkoutId)}`),
  agentTrace: (checkoutId: string) => getJSON<AuditEventRow[]>(`/dashboard/agent-trace/${checkoutId}`),
  failures: () => getJSON<FailuresResponse>("/dashboard/failures"),
};

export function formatINR(amount: number | null): string {
  if (amount === null || amount === undefined) return "\u2014";
  return `\u20B9${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" });
}
