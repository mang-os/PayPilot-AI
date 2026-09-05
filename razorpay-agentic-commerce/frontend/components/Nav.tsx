"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MouseEvent, SyntheticEvent } from "react";

const INSPECTION_LINKS = [
  { href: "/agent-trace#overview", label: "Overview" },
  { href: "/agent-trace#execution", label: "Execution" },
  { href: "/agent-trace#audit-trail", label: "Audit Trail" },
  { href: "/failures", label: "Safety" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeHash, setActiveHash] = useState("#overview");
  const isBuyer = pathname === "/";
  const isInspection = pathname === "/agent-trace" || pathname.startsWith("/transactions") || pathname === "/failures";

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || "#overview");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  // Read at activation because the checkout picker can update history without remounting Nav.
  const refreshCheckoutLink = (event: SyntheticEvent<HTMLAnchorElement>) => {
    const target = new URL(event.currentTarget.href);
    const currentParams = new URLSearchParams(window.location.search);
    const checkout = currentParams.get("checkout");
    const intent = currentParams.get("intent");
    if (checkout) target.searchParams.set("checkout", checkout);
    else target.searchParams.delete("checkout");
    if (intent) target.searchParams.set("intent", intent);
    else target.searchParams.delete("intent");
    event.currentTarget.href = target.href;
    return `${target.pathname}${target.search}${target.hash}`;
  };

  const checkoutLinkEvents = {
    onMouseEnter: refreshCheckoutLink,
    onFocus: refreshCheckoutLink,
    onContextMenu: refreshCheckoutLink,
    onAuxClick: refreshCheckoutLink,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      const href = refreshCheckoutLink(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = new URL(href, window.location.origin);
      if (target.hash) setActiveHash(target.hash);
      if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash) {
        window.location.hash = target.hash;
      } else {
        router.push(href);
      }
    },
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#E3E8EF] bg-white text-[#0B1220]">
      <div className="mx-auto flex min-h-16 max-w-[1280px] flex-wrap items-center gap-x-7 gap-y-1 px-5 py-2 md:px-8">
        <Link href="/" {...checkoutLinkEvents} className="mr-auto flex min-h-11 items-center font-display text-sm font-semibold tracking-tight focus-visible:outline-[#4F46E5]" aria-label="PayPilot AI home">
          PayPilot AI
        </Link>
        <nav aria-label="Primary" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex items-center gap-1">
            {[
              { href: "/", label: "Buyer", active: isBuyer },
              { href: "/agent-trace", label: "Merchant Control", active: isInspection },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  {...checkoutLinkEvents}
                  aria-current={link.active ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-[#4F46E5] ${link.active ? "bg-[#EEF2FF] text-[#4F46E5]" : "text-[#667085] hover:bg-[#F8FAFC] hover:text-[#0B1220]"}`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <span className="text-[11px] text-[#667085]">
          Razorpay Test Mode
        </span>
      </div>
      {isInspection && (
        <nav aria-label="Transaction inspection" className="border-t border-[#E3E8EF] bg-[#F8FAFC]">
          <ul className="mx-auto flex max-w-[1280px] items-center gap-5 overflow-x-auto px-5 md:px-8">
            {INSPECTION_LINKS.map((link) => {
              const [linkPath, linkHash = ""] = link.href.split("#");
              const active = linkPath === "/failures"
                ? pathname === "/failures"
                : pathname === "/agent-trace" && activeHash === `#${linkHash}`;
              return (
                <li key={link.href} className="shrink-0">
                  <Link href={link.href} {...checkoutLinkEvents} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center border-b-2 text-xs transition-colors focus-visible:outline-[#4F46E5] ${active ? "border-[#4F46E5] font-medium text-[#4F46E5]" : "border-transparent text-[#667085] hover:text-[#0B1220]"}`}>
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
