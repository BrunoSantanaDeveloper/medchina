import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-pooled) connection string; required for DDL.
    url: process.env.DATABASE_URL!,
  },
});
