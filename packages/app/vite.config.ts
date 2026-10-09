import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  // No server environment variables are exposed to browser bundles.
  envPrefix: [],
  server: {
    https: existsSync(new URL("../../.dev-certs/key.pem", import.meta.url)) ? { key: readFileSync(new URL("../../.dev-certs/key.pem", import.meta.url)), cert: readFileSync(new URL("../../.dev-certs/cert.pem", import.meta.url)) } : undefined,
    // Keep Host and Origin together for the backend's same-origin checks.
    // Run the API with APP_ORIGIN=https://localhost:5173 for local browser work.
    proxy: Object.fromEntries(
      ["/api", "/oauth", "/auth", "/authorize", "/device", "/webhooks", "/internal", "/mcp", "/healthz", "/.well-known"].map(
        path => [path, {
          target: "https://localhost:8787", changeOrigin: false, secure: false,
          bypass(request) {
            // Native-auth and consent/device GET screens are owned by Vite.
            // Provider callbacks, legacy POST forms and protocols stay on the API.
            if (request.method === "GET" && /^(?:\/authorize|\/device)(?:\?|$)/.test(request.url ?? "")) return "/index.html";
            if (request.method === "GET" && /^\/auth\/(?:login|signup|password-reset|verify(?:\/request)?)(?:\?|$)/.test(request.url ?? "")) return "/index.html";
          },
        }],
      ),
    ),
  },
});
