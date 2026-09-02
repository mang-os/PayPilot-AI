"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, formatINR, type TransactionRow, type FailuresResponse } from "@/lib/api";

export default function OverviewPage() {
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [failures, setFailures] = useState<FailuresResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.transactions(), api.failures()])
      .then(([t, f]) => {
        setTransactions(t);
        setFailures(f);
      })
      .catch(() => setError("Couldn't reach the API. Is the backend running on NEXT_PUBLIC_API_URL?"));
  }, []);

  const paidCount = transactions?.filter((t) => t.status === "PAID").length ?? 0;
  const totalValue = transactions?.filter((t) => t.status === "PAID").reduce((sum, t) => sum + t.final_amount, 0) ?? 0;
  const recoveredCount = failures?.failure_events.filter((e) => e.event_type === "ESCALATED").length ?? 0;

  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Agentic Commerce API</p>
      <h1 className="mt-3 font-display text-4xl font-semibold leading-tight text-ink md:text-5xl">
        Every rupee an AI agent moves here leaves a signed, verifiable trail.
      </h1>
      <p className="mt-5 max-w-xl font-sans text-base leading-relaxed text-inkmuted">
        Buyer agents discover products, sign a bounded spending mandate, and check out through a
        deterministic policy engine that never lets the agent set its own price. This console is
        that trail, made readable: every checkout, every approval, and every failure this API
        has recovered from.
      </p>

      {error && (
        <p className="mt-8 rounded-md border border-alert/30 bg-alert/5 px-4 py-3 font-mono text-sm text-alert">
          {error}
        </p>
      )}

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Completed orders" value={transactions === null ? "..." : String(paidCount)} />
        <StatCard label="Verified value" value={transactions === null ? "..." : formatINR(totalValue)} />
        <StatCard label="Failures recovered" value={failures === null ? "..." : String(recoveredCount)} />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NavCard
          href="/transactions"
          title="Transactions"
          description="Every completed order, its Razorpay payment, and the amount that actually settled."
        />
        <NavCard
          href="/agent-trace"
          title="Agent Trace"
          description="Pick a checkout and follow the exact sequence of checks it passed, in order."
        />
        <NavCard
          href="/failures"
          title="Failure Monitor"
          description="What went wrong, what the system did about it, and whether it recovered."
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 shadow-card">
      <p className="font-mono text-[11px] uppercase tracking-wide text-inkmuted">{label}</p>
      <p className="ledger-figure mt-1 font-display text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-hairline bg-surface p-4 shadow-card transition-colors hover:border-seal/50"
    >
      <p className="font-display text-base font-semibold text-ink group-hover:text-seal">{title}</p>
      <p className="mt-1.5 font-sans text-sm leading-relaxed text-inkmuted">{description}</p>
    </Link>
  );
}
