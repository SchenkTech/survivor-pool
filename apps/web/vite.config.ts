import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const api = "http://localhost:8080";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // The manifest is served by the API from admin-editable settings
      // (name, color, icon), so the plugin must not generate a static one.
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Picks and scores are live data -- never answer them from cache.
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": api,
      "/manifest.webmanifest": api,
      "/icon.svg": api,
    },
  },
});
