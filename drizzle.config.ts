import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// One Neon project, two branches, two URLs — see CLAUDE.md. `npm run db:push`
// targets the dev branch (DATABASE_URL); `npm run db:push:prod` sets
// DRIZZLE_TARGET=prod to reach the branch Vercel reads (PROD_DATABASE_URL).
// A schema change is only shipped once it has gone to both.
const isProd = process.env.DRIZZLE_TARGET === "prod";
const urlVar = isProd ? "PROD_DATABASE_URL" : "DATABASE_URL";
const url = process.env[urlVar];

if (!url) {
  throw new Error(
    `${urlVar} is not set in .env.local (drizzle target: ${isProd ? "prod" : "dev"})`
  );
}

if (isProd) {
  console.warn("\n⚠  drizzle target: PRODUCTION branch — this is the DB Vercel reads.\n");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
