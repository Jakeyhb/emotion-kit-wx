import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/log-admin/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/admin": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "../node-ai-service/public/log-admin",
    emptyOutDir: true,
  },
});
