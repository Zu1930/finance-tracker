import { defineConfig } from "drizzle-kit";

/** Только генерация миграций (npm run db:generate); применяет их scripts/db-migrate.ts */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/data/postgres/schema.ts",
  out: "./drizzle",
});
