import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base:   "rgb(var(--color-base) / <alpha-value>)",
        "s1":  "rgb(var(--color-s1) / <alpha-value>)",
        "s2":  "rgb(var(--color-s2) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        hi:     "rgb(var(--color-hi) / <alpha-value>)",
        lo:     "rgb(var(--color-lo) / <alpha-value>)",
        ok:     "rgb(var(--color-ok) / <alpha-value>)",
        ai:     "rgb(var(--color-ai) / <alpha-value>)",
        pay:    "rgb(var(--color-pay) / <alpha-value>)",
        err:    "rgb(var(--color-err) / <alpha-value>)",

        // ── Legacy tokens (kept for existing sub-pages) ─────────────────────
        paper:    "#EDEEF2",
        surface:  "#FFFFFF",
        ink:      "#10192B",
        inkmuted: "#5A6478",
        hairline: "#D8DBE2",
        seal:     "#B8912F",
        verified: "#55C596",
        alert:    "#B23B2E",
        wire:     "#4D8CFF",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        sans:    ["var(--font-plex-sans)",    "system-ui", "sans-serif"],
        mono:    ["var(--font-plex-mono)",    "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,25,43,0.06), 0 1px 1px rgba(16,25,43,0.04)",
        panel: "0 0 0 1px rgba(41,47,59,0.9), 0 18px 60px rgba(0,0,0,0.28)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "fade-in":    "fadeIn 0.25s ease-out both",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
