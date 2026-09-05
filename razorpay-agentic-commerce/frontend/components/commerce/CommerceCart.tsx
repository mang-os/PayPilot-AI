import type { CheckoutDetail } from "@/lib/api";
import { formatINR, formatTimestamp } from "@/lib/api";

function DetailRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-5 ${emphasis ? "pt-4 text-hi" : "text-lo"}`}><span className="text-sm">{label}</span><span className={`ledger-figure font-mono text-sm ${emphasis ? "font-semibold text-hi" : "text-hi/85"}`}>{value}</span></div>;
}

export default function CommerceCart({ checkout, onFocusJourney, presentation = "inspection" }: { checkout: CheckoutDetail | null; onFocusJourney: () => void; presentation?: "buyer" | "inspection" }) {
  if (presentation === "buyer") {
    if (!checkout) {
      return (
        <aside className="rounded-xl border border-[#E3E8EF] bg-white p-5 sm:p-6" aria-labelledby="commerce-cart-title">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#667085]">Your purchase</p>
          <h3 id="commerce-cart-title" className="mt-2 text-lg font-semibold text-[#0B1220]">Preparing your purchase</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#667085]">Your chosen items and backend-calculated total will appear here.</p>
        </aside>
      );
    }

    return (
      <aside className="rounded-xl border border-[#E3E8EF] bg-white p-5 sm:p-6" aria-labelledby="commerce-cart-title">
        <h3 id="commerce-cart-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#667085]">Your purchase</h3>

        <div className="mt-5 space-y-4">
          {checkout.items.map((item) => (
            <div key={`${item.product_id}-${item.name}`} className="flex items-baseline justify-between gap-4 text-sm">
              <p className="min-w-0 font-medium leading-relaxed text-[#0B1220]">{item.name} <span className="whitespace-nowrap text-[#667085]">× {item.quantity}</span></p>
              <p className="shrink-0 text-right tabular-nums text-[#667085]">{formatINR(item.unit_price)} <span className="text-xs">each</span></p>
            </div>
          ))}
        </div>

        <dl className="mt-5 space-y-3 border-t border-[#E3E8EF] pt-5 text-sm">
          <div className="flex items-baseline justify-between gap-4"><dt className="text-[#667085]">Subtotal</dt><dd className="text-right tabular-nums text-[#0B1220]">{formatINR(checkout.subtotal)}</dd></div>
          {checkout.discount_amount !== null && <div className="flex items-baseline justify-between gap-4"><dt className="text-[#667085]">{checkout.offer_code || "Discount"}</dt><dd className="text-right tabular-nums text-[#0B1220]">−{formatINR(checkout.discount_amount)}</dd></div>}
          <div className="flex items-baseline justify-between gap-4"><dt className="text-[#667085]">Tax</dt><dd className="text-right tabular-nums text-[#0B1220]">{formatINR(checkout.tax_amount)}</dd></div>
          <div className="flex items-baseline justify-between gap-4 border-t border-[#E3E8EF] pt-4"><dt className="font-semibold text-[#0B1220]">Total</dt><dd className="text-right text-2xl font-semibold tracking-tight tabular-nums text-[#0B1220]">{formatINR(checkout.final_amount)}</dd></div>
          {checkout.mandate && <div className="flex items-baseline justify-between gap-4"><dt className="text-[#667085]">Authorized spend</dt><dd className="text-right tabular-nums text-[#0B1220]">{formatINR(checkout.mandate.max_amount)}</dd></div>}
        </dl>

        <button type="button" onClick={onFocusJourney} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-[#4F46E5] underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F46E5]">View transaction in Merchant Control <span className="ml-2" aria-hidden="true">→</span></button>
      </aside>
    );
  }

  if (!checkout) {
    return (
      <aside className="rounded-xl border border-border bg-s1 p-6 shadow-panel" aria-labelledby="commerce-cart-title">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai">Current transaction</p>
        <h2 id="commerce-cart-title" className="mt-2 font-display text-2xl font-semibold text-hi">Purchase summary</h2>
        <div className="mt-8 border-y border-dashed border-border py-7">
          <p className="font-display text-lg text-hi">Awaiting a real checkout</p>
          <p className="mt-2 text-sm leading-relaxed text-lo">Catalog inspection is read-only. A cart appears here only after the authenticated buyer flow persists a checkout.</p>
        </div>
      </aside>
    );
  }

  const mandatePercent = checkout.mandate && checkout.final_amount !== null ? Math.min(100, (checkout.final_amount / checkout.mandate.max_amount) * 100) : 0;
  return (
    <aside className="rounded-xl border border-ai/30 bg-s1 p-6 shadow-panel" aria-labelledby="commerce-cart-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai">Current transaction</p>
          <h2 id="commerce-cart-title" className="mt-2 font-display text-2xl font-semibold text-hi">Purchase summary</h2>
        </div>
        <span className="rounded-full border border-ai/30 bg-ai/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ai">{checkout.status}</span>
      </div>

      <div className="mt-6 space-y-4">
        {checkout.items.map((item) => <div key={`${item.product_id}-${item.name}`} className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ai"/><div className="min-w-0"><p className="truncate text-sm font-medium text-hi">{item.name}</p><p className="mt-1 font-mono text-[10px] text-lo">Quantity × {item.quantity} · {formatINR(item.unit_price)} each</p></div></div>)}
      </div>

      <div className="mt-6 space-y-3 border-y border-border py-5">
        <DetailRow label="Subtotal" value={formatINR(checkout.subtotal)} />
        {checkout.offer_code && <DetailRow label={checkout.offer_code} value={`−${formatINR(checkout.discount_amount)}`} />}
        <DetailRow label="Tax" value={formatINR(checkout.tax_amount)} />
        <DetailRow label="Total" value={formatINR(checkout.final_amount)} emphasis />
      </div>

      {checkout.mandate ? (
        <section className="mt-6" aria-label="Spending authority">
          <div className="flex items-baseline justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lo">Spending authority</p><span className="font-mono text-[10px] text-ok">{checkout.mandate.status}</span></div>
          <p className="ledger-figure mt-2 font-display text-xl font-semibold text-hi">{formatINR(checkout.final_amount)} <span className="text-sm font-normal text-lo">/ {formatINR(checkout.mandate.max_amount)}</span></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-base"><div className="h-full rounded-full bg-gradient-to-r from-ai to-pay" style={{ width: `${mandatePercent}%` }} /></div>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.11em] text-lo">Mandate expires {formatTimestamp(checkout.mandate.expires_at)}</p>
        </section>
      ) : <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.13em] text-lo">No mandate is attached to this checkout.</p>}

      <button type="button" onClick={onFocusJourney} className="mt-7 w-full rounded-lg bg-hi px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-base transition hover:bg-pay hover:text-white">View transaction execution</button>
      <p className="mt-3 break-all text-center font-mono text-[9px] text-lo">{checkout.checkout_id}</p>
    </aside>
  );
}
