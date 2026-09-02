"use client";

import { useEffect, useState } from "react";
import { api, formatINR, formatTimestamp, type TransactionRow } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

export default function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.transactions().then(setRows).catch(() => setError("Couldn't load transactions."));
  };

  useEffect(load, []);

  return (
    <div>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Transactions</h1>
          <p className="mt-1 max-w-lg font-sans text-sm text-inkmuted">
            One row per order created by a verified webhook - never a client-reported success.
          </p>
        </div>
        <button
          onClick={load}
          className="flex-shrink-0 rounded-md border border-hairline bg-surface px-3 py-1.5 font-sans text-sm text-ink shadow-card hover:border-seal/50"
        >
          Refresh
        </button>
      </header>

      {error && <p className="mt-6 font-mono text-sm text-alert">{error}</p>}

      {rows === null && !error && <p className="mt-8 font-mono text-sm text-inkmuted">Loading...</p>}

      {rows !== null && rows.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-hairline p-8 text-center">
          <p className="font-sans text-sm text-inkmuted">
            No completed orders yet. Run the demo buyer agent script to create one.
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-hairline bg-surface shadow-card">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-wide text-inkmuted">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Order Status</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.order_id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3 font-mono text-sm text-ink">{row.order_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-inkmuted">{row.agent_id}</td>
                  <td className="ledger-figure px-4 py-3 font-mono text-sm text-ink">
                    {formatINR(row.final_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.transaction_status} />
                  </td>
                  <td className="px-4 py-3 font-sans text-xs text-inkmuted">{formatTimestamp(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
