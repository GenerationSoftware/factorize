import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/postgres/schema.ts",
  // Existing SQL migrations remain the immutable deployment history. New
  // migrations are reviewed into that same directory.
  out: "./migrations",
  schemaFilter: ["app"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://localhost/factorize" },
  strict: true,
  verbose: true,
});
