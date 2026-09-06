import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        track: "#111114",
        panel: "#1b1b21",
        lane: "#F4F1EA",
        chalk: "#9C988C",
        pistol: "#FF4B2E",
        finish: "#22C58B",
        amber: "#FFB020",
        gold: "#FFD24C",
        silver: "#CBD2DA",
        bronze: "#E08A4B",
      },
      fontFamily: {
        display: ["Oswald", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(255,75,46,0.55)",
        "glow-finish": "0 0 40px -8px rgba(34,197,139,0.55)",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "70%": { transform: "scale(1.25)", opacity: "0" },
          "100%": { transform: "scale(1.25)", opacity: "0" },
        },
        floatIn: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        floatIn: "floatIn 0.35s ease-out both",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
