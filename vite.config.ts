import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// es2019: also runs on phones a few years old (Safari 12.1+, Chrome 73+), not
// just current browsers — a school's volunteers bring whatever they own.
export default defineConfig({ plugins: [react()], build: { target: "es2019" } });
