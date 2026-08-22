/**
 * The three values Vercel sets for VERCEL_ENV. Anything else, while on Vercel, is a state
 * this project does not understand — and guessing at it is how a deploy ends up shipping
 * code against an un-migrated schema.
 */
const VERCEL_ENVIRONMENTS = new Set(["production", "preview", "development"]);

/**
 * True when no Vercel environment is present at all — i.e. a laptop.
 *
 * Exported because scripts/migrate.mjs needs the same predicate to decide whether to load
 * .env.local. One definition, two call sites, no drift.
 *
 * Reads `env.VERCEL` rather than testing own-property-ness deliberately: an inherited
 * value still counts as "on Vercel", which errs toward refusing to migrate.
 *
 * @param {{ VERCEL?: string, VERCEL_ENV?: string }} env
 * @returns {boolean}
 */
export function isLocal(env) {
  return env.VERCEL === undefined && env.VERCEL_ENV === undefined;
}

/**
 * Decide whether this process may apply migrations, and how the caller should exit.
 *
 * Default-deny. The only permitted runs are a Vercel *production* deploy and a machine
 * with no Vercel environment at all (a laptop, targeting the dev branch).
 *
 * `outcome` exists because a wrong "no" is as dangerous as a wrong "yes":
 *   - "skip"    a legitimate preview or development build. Exit 0; the deploy is fine.
 *   - "unknown" on Vercel, but VERCEL_ENV is absent, blank, or not one Vercel defines.
 *               Should be unreachable. The caller must FAIL THE BUILD, because skipping
 *               quietly here ships code against an un-migrated schema.
 *
 * Comparison is strict equality against a literal — no trimming, no case folding, no
 * substring test. Each of those would open a hole; " production" and "Production" are
 * both refused.
 *
 * Pure: reads the object it is given, touches nothing else.
 *
 * @param {{ VERCEL?: string, VERCEL_ENV?: string }} env
 * @returns {{ run: boolean, outcome: "local"|"production"|"skip"|"unknown", reason: string }}
 */
export function shouldMigrate(env) {
  if (isLocal(env)) {
    // Deliberately does not name .env.local: the emergency path passes a production
    // DATABASE_URL inline, and the caller logs the real target host separately.
    return { run: true, outcome: "local", reason: "local run" };
  }
  if (env.VERCEL_ENV === "production") {
    return { run: true, outcome: "production", reason: "Vercel production deploy" };
  }
  if (VERCEL_ENVIRONMENTS.has(env.VERCEL_ENV)) {
    return { run: false, outcome: "skip", reason: `skipped — VERCEL_ENV=${env.VERCEL_ENV}` };
  }
  return {
    run: false,
    outcome: "unknown",
    reason: `refusing — on Vercel with an unrecognized VERCEL_ENV=${env.VERCEL_ENV ?? "(unset)"}`,
  };
}
