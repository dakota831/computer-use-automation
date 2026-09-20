import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The operator console is the only real UI in this system. It is a separate
 * build rooted at web/, served in production by the same Node process that
 * runs the API, so there is one process and one port to reason about.
 *
 * In development Vite proxies /api and /ws through to that server, so the
 * frontend never needs to know where the backend lives.
 */
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist-web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4000", ws: true },
    },
  },
});
