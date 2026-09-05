"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { api, formatINR, formatTimestamp, type TransactionRow } from "@/lib/api";

function merchantControlHref(checkoutId: string, currentCheckoutId: string, buyerIntent: string) {
  const params = new URLSearchParams({ checkout: checkoutId });
  if (checkoutId === currentCheckoutId && buyerIntent) params.set("intent", buyerIntent);
  return `/agent-trace?${params.toString()}`;
}

export default function PaymentRecordsPage() {
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [currentCheckoutId, setCurrentCheckoutId] = useState("");
  const [buyerIntent, setBuyerIntent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setRows(null);
    setError(null);
    api.transactions().then(setRows).catch(() => setError("Couldn't load payment records."));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCurrentCheckoutId(params.get("checkout")?.trim() ?? "");
    setBuyerIntent(params.get("intent")?.trim() ?? "");
    load();
  }, []);

  const currentRecordExists = Boolean(
    currentCheckoutId && rows?.some((row) => row.checkout_id === currentCheckoutId),
  );

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-5 border-b border-border pb-7">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ai">
            PayPilot AI · Merchant Control
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-hi">Payment records</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-lo">
            Razorpay orders and payments recorded from backend-verified transaction evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="min-h-11 rounded-lg border border-border bg-s1 px-4 text-sm font-medium text-hi shadow-card transition-colors hover:border-ai/50 hover:text-ai"
        >
          Refresh
        </button>
      </header>

      {currentCheckoutId && rows && !currentRecordExists && (
        <div className="mb-6 rounded-lg border border-border bg-s1 px-4 py-3 shadow-card">
          <p className="text-sm text-lo">
            The current checkout has no verified payment record yet. Its checkout remains selected across Merchant Control.
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-hi">{currentCheckoutId}</p>
          <Link
            href={merchantControlHref(currentCheckoutId, currentCheckoutId, buyerIntent)}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-ai underline-offset-4 hover:underline"
          >
            Return to current transaction →
          </Link>
        </div>
      )}

      {error && <p role="alert" className="mb-6 rounded-lg border border-err/30 bg-err/5 px-4 py-3 text-sm text-err">{error}</p>}
      {rows === null && !error && <p className="font-mono text-xs text-lo">Loading payment records…</p>}

      {rows !== null && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-s1 px-6 py-12 text-center">
          <p className="text-sm text-lo">No verified Razorpay payment records yet.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-s1 shadow-card">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-border bg-s2">
                {["Checkout", "Order ID", "Agent", "Amount", "Order status", "Payment", "Created"].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-widest text-lo">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const current = row.checkout_id === currentCheckoutId;
                return (
                  <tr
                    key={row.order_id}
                    className={`border-b border-border/50 transition-colors last:border-0 hover:bg-s2 ${current ? "bg-ai/5" : ""}`}
                  >
                    <td className="max-w-[160px] px-4 py-3 font-mono text-[11px]">
                      <Link
                        href={merchantControlHref(row.checkout_id, currentCheckoutId, buyerIntent)}
                        className="block truncate text-ai underline-offset-4 hover:underline"
                        aria-label={`Open checkout ${row.checkout_id} in Merchant Control`}
                      >
                        {row.checkout_id}
                      </Link>
                      {current && <span className="mt-1 block text-[9px] uppercase tracking-wider text-lo">Current transaction</span>}
                    </td>
                    <td className="max-w-[150px] truncate px-4 py-3 font-mono text-[11px] text-hi">{row.order_id}</td>
                    <td className="max-w-[130px] truncate px-4 py-3 font-mono text-[11px] text-lo">{row.agent_id}</td>
                    <td className="ledger-figure px-4 py-3 font-mono text-sm font-medium text-hi">{formatINR(row.final_amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3"><StatusBadge status={row.transaction_status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-[11px] text-lo">{formatTimestamp(row.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
