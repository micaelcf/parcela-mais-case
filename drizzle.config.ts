import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required (set it in .env.local)");

export default defineConfig({
  out: "./drizzle",
  schema: "./src/server/infra/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
});
