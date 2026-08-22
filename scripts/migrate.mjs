#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isLocal, shouldMigrate } from "./should-migrate.mjs";
import { secretsInUrl, withoutSecrets } from "./without-secrets.mjs";

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

// Gathered before anything parses the URL, because the parse itself can throw carrying
// the connection string, and that error has to be scrubbable.
const secrets = secretsInUrl(url);

// `new URL` throws ERR_INVALID_URL with the whole connection string on an own `input`
// property, and Node's uncaught-exception printer inspects own properties — so an
// unguarded parse prints the password straight into a durable build log.
let target;
try {
  target = new URL(url);
} catch (error) {
  console.error("[migrate] DATABASE_URL is not a valid URL:", withoutSecrets(error, secrets));
  process.exit(1);
}

// Host only. The full URL carries the password and build logs are durable.
console.log(`[migrate] target host: ${target.host}`);

const { neon } = await import("@neondatabase/serverless");
const { drizzle } = await import("drizzle-orm/neon-http");
const { migrate } = await import("drizzle-orm/neon-http/migrator");

try {
  const journal = JSON.parse(await readFile("./drizzle/meta/_journal.json", "utf8"));
  const sql = neon(url);

  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });

  // The migrator applies only journal entries newer than the newest recorded one, so a
  // migration generated out of order is skipped in silence. Reporting both counts puts
  // that in the one artifact anyone reads after a deploy — "up to date" on its own cannot
  // distinguish "applied everything" from "skipped everything".
  const [{ recorded }] = await sql`
    select count(*)::int as recorded from "drizzle"."__drizzle_migrations"`;

  console.log(
    `[migrate] up to date — ${recorded} of ${journal.entries.length} migration(s) recorded`
  );
} catch (error) {
  // The driver's error is outside our control and may carry the connection string, the
  // encoded password, or the decoded one. secretsInUrl covers all three.
  console.error("[migrate] failed:", withoutSecrets(error, secrets));
  process.exit(1);
}
