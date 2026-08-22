import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// One variable, correct in both places it is read: locally `.env.local` points it at the
// Neon dev branch, and on Vercel the project's own DATABASE_URL is the production
// branch. Nothing on a laptop holds a production schema-write credential.
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is not set in .env.local");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
