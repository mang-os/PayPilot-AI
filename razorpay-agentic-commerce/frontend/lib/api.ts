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

export const api = {
  transactions: () => getJSON<TransactionRow[]>("/dashboard/transactions"),
  checkouts: () => getJSON<CheckoutRow[]>("/dashboard/checkouts"),
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
