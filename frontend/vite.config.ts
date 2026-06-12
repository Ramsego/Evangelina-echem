import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  optimizeDeps: {
    include: ["plotly.js", "react-plotly.js"],
  },
  server: {
    // Honour PORT when the harness/preview assigns one; default 5173 otherwise
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
