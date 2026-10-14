import type { Config } from "tailwindcss";

// Colours are CSS variables (see src/index.css) so the light "sunlight" theme
// and the dark "floodlight" theme share every class.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        card: v("card"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        start: v("start"),
        finish: v("finish"),
        gold: v("gold"),
        silver: v("silver"),
        bronze: v("bronze"),
      },
      fontFamily: {
        display: ["Kanit", "sans-serif"],
        body: ['"IBM Plex Sans Thai"', "Kanit", "sans-serif"],
      },
      keyframes: {
        rise: { from: { transform: "translateY(10px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        ping2: { "75%,100%": { transform: "scale(2.2)", opacity: "0" } },
        flash: { from: { opacity: "0.9" }, to: { opacity: "0" } },
        shrink: { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
      },
      animation: {
        rise: "rise .35s cubic-bezier(.2,.8,.2,1) both",
        ping2: "ping2 1.6s cubic-bezier(0,0,.2,1) infinite",
        flash: "flash .6s ease-out both",
        shrink: "shrink linear both",
      },
    },
  },
  plugins: [],
} satisfies Config;
