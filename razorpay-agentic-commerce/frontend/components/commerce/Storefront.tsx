"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogProduct, OfferRow } from "@/lib/api";
import { formatINR } from "@/lib/api";
import ProductVisual from "./ProductVisual";

function categoryLabel(category: string) {
  return category.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function availability(product: CatalogProduct) {
  if (!product.inventory) return { label: "Inventory unavailable", tone: "text-lo" };
  if (product.inventory.quantity_available <= 0) return { label: "Currently unavailable", tone: "text-err" };
  if (product.inventory.quantity_available <= 5) return { label: `${product.inventory.quantity_available} available`, tone: "text-pay" };
  return { label: `${product.inventory.quantity_available} available`, tone: "text-ok" };
}

export default function Storefront({
  products,
  offers,
  intentQuery,
  cartProductIds,
  inspectedProductIds,
  onToggleInspect,
}: {
  products: CatalogProduct[];
  offers: OfferRow[];
  intentQuery: string;
  cartProductIds: string[];
  inspectedProductIds: string[];
  onToggleInspect: (productId: string) => void;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(intentQuery), [intentQuery]);
  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category))).sort(), [products]);
  const visibleProducts = useMemo(() => {
    const queryTerms = query.toLowerCase().match(/[a-z0-9-]+/g)?.filter((term) => term.length > 2 && !["find", "best", "under", "with", "the", "for"].includes(term)) ?? [];
    return products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category;
      const matchesQuery = queryTerms.length === 0 || queryTerms.some((term) => [product.name, product.description, product.sku, product.category].join(" ").toLowerCase().includes(term));
      return matchesCategory && matchesQuery;
    });
  }, [products, category, query]);

  return (
    <section aria-labelledby="catalog-title" className="mt-12">
      <div className="flex flex-col justify-between gap-5 border-y border-border py-5 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-pay">Live merchant catalog</p>
          <h2 id="catalog-title" className="mt-2 font-display text-3xl font-semibold tracking-tight text-hi">Discover what the merchant can fulfill.</h2>
        </div>
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search real catalog</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the real catalog"
            className="w-full rounded-lg border border-border bg-s1 px-4 py-3 pr-10 text-sm text-hi outline-none transition placeholder:text-lo/65 focus:border-ai"
          />
          <span className="pointer-events-none absolute right-4 top-3.5 text-lo" aria-hidden="true">⌕</span>
        </label>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => setCategory("all")} className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide transition ${category === "all" ? "border-hi/30 bg-hi text-base" : "border-border text-lo hover:border-lo hover:text-hi"}`}>All products <span className="ml-1 opacity-65">{products.length}</span></button>
        {categories.map((item) => (
          <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide transition ${category === item ? "border-ai/50 bg-ai/15 text-hi" : "border-border text-lo hover:border-lo hover:text-hi"}`}>{categoryLabel(item)}</button>
        ))}
      </div>

      {visibleProducts.length === 0 ? (
        <div className="mt-6 border border-dashed border-border px-6 py-14 text-center">
          <p className="font-display text-xl text-hi">No matching catalog records</p>
          <p className="mt-2 text-sm text-lo">Adjust the real-catalog search or category filter.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProducts.map((product) => {
            const stock = availability(product);
            const inPersistedCart = cartProductIds.includes(product.id);
            const inspected = inspectedProductIds.includes(product.id);
            const selected = inPersistedCart || inspected;
            const thresholdOffer = offers.find((offer) => product.price >= offer.min_cart_amount);
            return (
              <article key={product.id} className={`group overflow-hidden rounded-xl border bg-s1 transition duration-300 ${selected ? "border-ai/70 shadow-[0_0_0_1px_rgba(167,139,250,.16),0_22px_50px_rgba(0,0,0,.26)]" : "border-border hover:-translate-y-0.5 hover:border-lo/55 hover:bg-s2/55"}`}>
                <div className="h-44 border-b border-border"><ProductVisual product={product} /></div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-border bg-base/35 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-lo">{categoryLabel(product.category)}</span>
                    <span className="ledger-figure font-display text-xl font-semibold text-hi">{formatINR(product.price)}</span>
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold tracking-tight text-hi">{product.name}</h3>
                  <p className="mt-2 min-h-10 text-sm leading-relaxed text-lo">{product.description}</p>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/80 pt-4">
                    <div>
                      <p className={`font-mono text-[10px] uppercase tracking-wide ${stock.tone}`}>{stock.label}</p>
                      {product.inventory && product.inventory.reserved_quantity > 0 && <p className="mt-1 font-mono text-[9px] text-lo">{product.inventory.reserved_quantity} reserved</p>}
                    </div>
                    {inPersistedCart ? <span className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ok">In real cart</span> : <button type="button" onClick={() => onToggleInspect(product.id)} aria-pressed={inspected} className={`rounded-md border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${inspected ? "border-ai bg-ai/15 text-hi" : "border-border text-lo hover:border-ai/60 hover:text-hi"}`}>{inspected ? "Inspected" : "Inspect"}</button>}
                  </div>
                  {thresholdOffer && <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.1em] text-pay">{thresholdOffer.code} available from {formatINR(thresholdOffer.min_cart_amount)}</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
