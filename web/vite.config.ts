import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.LAB_URL || "http://127.0.0.1:7777";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: false },
      "/llm": { target, changeOrigin: false },
      "/mcp": { target, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 900,
  },
});
