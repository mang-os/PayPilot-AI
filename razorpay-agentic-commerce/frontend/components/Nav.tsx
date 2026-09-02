"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/agent-trace", label: "Agent Trace" },
  { href: "/failures", label: "Failure Monitor" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="bg-ink text-paper md:w-60 md:min-h-screen md:flex-shrink-0 md:sticky md:top-0">
      <div className="px-5 py-6 md:py-8">
        <div className="font-display text-lg font-semibold tracking-tight">Agentic Commerce</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-paper/60">
          <span className="font-mono">Merchant Console</span>
          <span className="rounded-sm border border-seal/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-seal">
            Test Mode
          </span>
        </div>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:overflow-visible md:pb-8">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href} className="flex-shrink-0">
              <Link
                href={link.href}
                className={`block whitespace-nowrap rounded-md px-3 py-2 font-sans text-sm transition-colors ${
                  active
                    ? "bg-paper/10 text-paper font-medium"
                    : "text-paper/70 hover:bg-paper/5 hover:text-paper"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
