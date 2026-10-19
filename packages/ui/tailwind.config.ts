import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#0f1117",
          surface: "#1a1d27",
          border: "#2a2d3e",
          accent: "#00a5b4",      // teal — primary action color
          "accent-dim": "#007a87",
          green: "#00c57e",
          neon: "#39ff14",       // neon green — CRIPTOGRAFIA brand
          red: "#f45b5b",
          yellow: "#f5a623",
          purple: "#9b6dff",
          text: "#e2e8f0",
          muted: "#64748b",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
