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
        path => [path, { target: "http://localhost:8787", changeOrigin: false }],
      ),
    ),
  },
});
