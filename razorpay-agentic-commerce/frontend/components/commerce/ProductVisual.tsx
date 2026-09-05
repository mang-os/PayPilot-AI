import type { CatalogProduct } from "@/lib/api";

function CategoryGlyph({ category }: { category: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (category === "audio") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><path {...common} d="M17 35v-5a15 15 0 0 1 30 0v5"/><path {...common} d="M17 33h7v14h-7zM40 33h7v14h-7z"/><path {...common} d="M24 48c3 3 13 3 16 0"/></svg>;
  }
  if (category === "computing") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><rect {...common} x="11" y="22" width="42" height="24" rx="4"/><path {...common} d="M18 30h28M18 37h3m5 0h3m5 0h3m5 0h3M24 45h16"/></svg>;
  }
  if (category === "mobile" || category === "accessories") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><rect {...common} x="21" y="11" width="22" height="42" rx="4"/><path {...common} d="M29 17h6M29 47h6"/><path {...common} d="M14 27h7M43 27h7"/></svg>;
  }
  if (category === "gaming") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><path {...common} d="M17 40c-2-8 0-17 6-19 5-2 8 3 9 3s4-5 9-3c6 2 8 11 6 19-1 5-5 6-9 2l-4-4H30l-4 4c-4 4-8 3-9-2Z"/><path {...common} d="M25 30v8m-4-4h8M40 31h.1M45 35h.1"/></svg>;
  }
  if (category === "wearables") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><rect {...common} x="22" y="7" width="20" height="50" rx="7"/><rect {...common} x="18" y="20" width="28" height="24" rx="5"/><path {...common} d="M27 32h10"/></svg>;
  }
  if (category === "smart-home") {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><path {...common} d="m13 30 19-16 19 16v20H13Z"/><path {...common} d="M26 50V37h12v13M21 29h.1M43 29h.1"/></svg>;
  }
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path {...common} d="m32 10 5 17 17 5-17 5-5 17-5-17-17-5 17-5Z"/></svg>;
}

export default function ProductVisual({ product, presentation = "inspection" }: { product: CatalogProduct; presentation?: "buyer" | "inspection" }) {
  if (product.image_url) {
    return <img src={product.image_url} alt={product.name} className={presentation === "buyer" ? "h-full w-full bg-[#F3F6F9] object-contain p-4" : "h-full w-full object-cover"} loading="lazy" />;
  }

  if (presentation === "buyer") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#F3F6F9] text-[#667085]" aria-label={`Image unavailable for ${product.name}`}>
        <span className="h-16 w-16"><CategoryGlyph category={product.category} /></span>
        <span className="text-xs">Image unavailable</span>
      </div>
    );
  }

  return (
    <div className="product-visual relative grid h-full w-full place-items-center overflow-hidden bg-gradient-to-br from-s2 via-s1 to-base text-hi/75" aria-label={`${product.category} catalog visual`}>
      <span className="absolute left-4 top-4 font-mono text-[9px] uppercase tracking-[0.17em] text-lo">{product.sku}</span>
      <span className="relative h-20 w-20 text-pay/80"><CategoryGlyph category={product.category} /></span>
      <span className="absolute bottom-4 font-mono text-[8px] uppercase tracking-[0.16em] text-lo/75">Catalog visual</span>
    </div>
  );
}
