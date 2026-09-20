import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

/**
 * Two entry points, one design system.
 *
 *   index.html  -> the operator console   (console.dexdash.cloud)
 *   site.html   -> the public explainer   (dexdash.cloud)
 *
 * A single build emits both and they share everything under src/shared, so the
 * chrome cannot drift between the front door and the tool. Both hosts serve the
 * same directory; nginx just picks a different index file.
 */
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        console: resolve(__dirname, "web/index.html"),
        site: resolve(__dirname, "web/site.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4000", ws: true },
    },
  },
});
