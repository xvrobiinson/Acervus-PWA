import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The public SEO landing pages: each is public/<name>/index.html, served by
// Cloudflare at /<name>/.
const SEO_PAGES = ["loan-management-software", "loan-tracking-software", "private-lending-software", "prestamos"];

export default defineConfig({
  // Shown in Settings › About.
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version) },
  plugins: [
    react(),
    VitePWA({
      // The app asks before switching to a new version, so nothing being
      // typed is lost; queued offline changes live in IndexedDB either way.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png", "fonts/*.ttf"],
      manifest: {
        id: "/",
        name: "Acervus Finance",
        short_name: "Acervus",
        description: "Lending portfolio: clients, loans, payments, income and expenses.",
        lang: "es",
        // The installed app opens on sign-in (signed-in people go on to their
        // dashboard); the public landing page stays at "/" in a browser.
        // `id` stays "/" so existing installs are the same app.
        start_url: "/sign-in",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#040405",
        theme_color: "#3B3E41",
        categories: ["finance", "business", "productivity"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The hero's backgrounds and the light font too, so the app looks the same offline.
        globPatterns: ["**/*.{js,css,html,svg,png,ttf,woff2,webmanifest}", "hero/*.jpg"],
        // The public SEO pages (plain HTML in public/, not the app) and their
        // stylesheet are never kept by the service worker: they always come
        // fresh from the site.
        globIgnores: [...SEO_PAGES.map((p) => `${p}/**`), "seo/**"],
        navigateFallback: "/index.html",
        // The desktop's Google sign-in page must never become the app, or
        // the app would use the sign-in token meant for the desktop. Nor may
        // the SEO pages: opening one goes to the site, not the app.
        navigateFallbackDenylist: [/^\/desktop-sign-in/, /^\/download\//, ...SEO_PAGES.map((p) => new RegExp(`^/${p}(/|$)`))],
        // Only the app itself is cached. Financial data never goes through
        // the service worker: it comes from Convex over a WebSocket and is
        // kept by the app in IndexedDB, per signed-in user.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
});
