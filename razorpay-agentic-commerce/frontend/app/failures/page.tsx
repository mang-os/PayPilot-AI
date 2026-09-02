"use client";

import { useEffect, useState } from "react";
import { api, formatINR, formatTimestamp, type FailuresResponse } from "@/lib/api";

export default function FailuresPage() {
  const [data, setData] = useState<FailuresResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.failures().then(setData).catch(() => setError("Couldn't load the failure monitor."));
  };

  useEffect(load, []);

  return (
    <div>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Failure Monitor</h1>
          <p className="mt-1 max-w-lg font-sans text-sm text-inkmuted">
            Nothing fails silently. Every rejection, timeout, and retry is logged here the
            moment it happens - open a checkout in Agent Trace to see exactly what it recovered
            into.
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

      {data !== null && data.failure_events.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-hairline p-8 text-center">
          <p className="font-sans text-sm text-inkmuted">
            No failures recorded yet. Run the demo script's failure scenarios to see this fill in:{" "}
            <code className="font-mono text-xs">--scenario invalid_product</code>,{" "}
            <code className="font-mono text-xs">duplicate_checkout</code>, or{" "}
            <code className="font-mono text-xs">razorpay_timeout</code>.
          </p>
        </div>
      )}

      {data !== null && data.failure_events.length > 0 && (
        <div className="mt-6 space-y-2">
          {data.failure_events.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border border-alert/25 bg-alert/5 px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs font-semibold uppercase tracking-wide text-alert">
                  {event.event_type}
                </span>
                {event.checkout_id && (
                  <span className="font-mono text-[11px] text-inkmuted">{event.checkout_id}</span>
                )}
                <span className="font-mono text-[11px] text-inkmuted">{formatTimestamp(event.created_at)}</span>
              </div>
              <p className="mt-1 font-sans text-sm leading-relaxed text-ink">{event.message}</p>
            </div>
          ))}
        </div>
      )}

      {data !== null && data.failed_checkouts.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-base font-semibold text-ink">Checkouts still in a failed state</h2>
          <p className="mt-1 font-sans text-sm text-inkmuted">
            Not retried yet, or the failure wasn&rsquo;t recoverable without agent input (like a bad product ID).
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-hairline bg-surface shadow-card">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-wide text-inkmuted">
                  <th className="px-4 py-3 font-medium">Checkout</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.failed_checkouts.map((c) => (
                  <tr key={c.checkout_id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 font-mono text-sm text-ink">{c.checkout_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-alert">{c.failure_reason ?? "unknown"}</td>
                    <td className="ledger-figure px-4 py-3 font-mono text-sm text-ink">{formatINR(c.final_amount)}</td>
                    <td className="px-4 py-3 font-sans text-xs text-inkmuted">{formatTimestamp(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
