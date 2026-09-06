import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        track: "#1B1B1E",
        lane: "#EDEAE0",
        chalk: "#B8B4A8",
        pistol: "#FF4B2E",
        finish: "#22C58B",
        amber: "#FFB020",
      },
      fontFamily: {
        display: ["Oswald", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
