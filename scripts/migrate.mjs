#!/usr/bin/env node
import { isLocal, shouldMigrate } from "./should-migrate.mjs";

// The guard reads the real process environment, deliberately before .env.local is
// loaded. `vercel env pull` can write VERCEL_ENV into that file, and a value from a
// file must not be able to change whether we are "on Vercel".
const decision = shouldMigrate(process.env);

// An unrecognized Vercel environment fails the build rather than skipping quietly. A
// silent skip on a production deploy would ship code against an un-migrated schema —
// the outage this whole mechanism replaces. Legitimate previews report "skip", not
// "unknown", so nothing normal is affected. Reported on stderr because it is a build
// failure; every other outcome is ordinary progress on stdout.
if (decision.outcome === "unknown") {
  console.error(`[migrate] ${decision.reason}`);
  process.exit(1);
}

console.log(`[migrate] ${decision.reason}`);
if (!decision.run) process.exit(0);

// dotenv is a devDependency, so it must never be required on the deploy path. Only a
// local run loads it, and only via dynamic import. Reuses the guard's own predicate so
// there is one definition of "on Vercel".
if (isLocal(process.env)) {
  const { config } = await import("dotenv");
  // dotenv does not overwrite variables already in the environment, which is what makes
  // `DATABASE_URL=<prod-url> node scripts/migrate.mjs` work as an emergency override.
  // Never pass `override: true`.
  config({ path: ".env.local" });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

// Host only. The full URL carries the password and build logs are durable.
console.log(`[migrate] target host: ${new URL(url).host}`);

const { neon } = await import("@neondatabase/serverless");
const { drizzle } = await import("drizzle-orm/neon-http");
const { migrate } = await import("drizzle-orm/neon-http/migrator");

try {
  await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  console.log("[migrate] schema up to date");
} catch (error) {
  console.error("[migrate] failed:", error);
  process.exit(1);
}
