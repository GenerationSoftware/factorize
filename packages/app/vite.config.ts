import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  // No server environment variables are exposed to browser bundles.
  envPrefix: [],
  server: {
    // Keep Host and Origin together for the backend's same-origin checks.
    // Run the API with APP_ORIGIN=http://localhost:5173 for local browser work.
    proxy: Object.fromEntries(
      ["/api", "/oauth", "/auth", "/authorize", "/device", "/webhooks", "/internal", "/mcp", "/healthz", "/.well-known"].map(
        path => [path, {
          target: "http://localhost:8787", changeOrigin: false,
          bypass(request) {
            // Only native-auth GET screens are owned by Vite in this stage.
            // Provider callbacks, legacy POST forms and protocols stay on the API.
            if (request.method === "GET" && /^\/auth\/(?:login|signup|password-reset|verify(?:\/request)?)(?:\?|$)/.test(request.url ?? "")) return "/index.html";
          },
        }],
      ),
    ),
  },
});
