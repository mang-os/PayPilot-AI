import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EDEEF2",       // primary page surface - cool ledger paper, not warm cream
        surface: "#FFFFFF",     // card / panel surface
        ink: "#10192B",         // primary text + console rail background
        inkmuted: "#5A6478",    // secondary text
        hairline: "#D8DBE2",    // borders/dividers
        seal: "#B8912F",        // brass seal - verified/primary actions, signature moments
        verified: "#2F7A5C",    // paid / completed / policy-approved
        alert: "#B23B2E",       // failed / rejected / timeout
        wire: "#3E5C8A",        // pending / in-flight / informational
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 25, 43, 0.06), 0 1px 1px rgba(16, 25, 43, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
