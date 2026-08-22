# 0004 — Migrations applied by the deploy

## Context

Schema reached the two Neon branches by hand, through `npm run db:push` and
`npm run db:push:prod`. Nothing connected either to a deploy and there was no migrations
directory, so nothing reconciled the branches and nothing failed at build time. A table
pushed to dev but not prod compiled, tested, and deployed green, then 500ed the first
authenticated request that touched it.

That happened twice: `rto_targets` after `d93c037`, and `wfh_mandates` after `431cff2`,
which broke every authenticated render of `/` because `src/app/page.tsx` selects from it.
Documentation had already been tried — CLAUDE.md carried an emphatic bolded warning naming
the first outage, and the second happened anyway, five days after the spec that shipped
the table told the reader to use `push`.

The step that made production correct was a human remembering a second command.

## Decision

Schema changes are **versioned migrations, committed to the repo**, and the **production
build applies them**. `vercel.json` sets `buildCommand` to
`next build && node scripts/migrate.mjs`; that script consults the pure
`shouldMigrate(env)` guard and proceeds only on `VERCEL_ENV=production` or on a machine
with no Vercel environment at all. A failed migration exits non-zero, which fails the
build, and a failed build is never promoted.

`PROD_DATABASE_URL`, `DRIZZLE_TARGET`, `db:push`, and `db:push:prod` are deleted. On
Vercel `DATABASE_URL` is already the production branch and locally it is already dev, so
one variable is correct in both places and no laptop holds a production connection
string. See the consequence below for what that does and does not buy.

The emergency path is an inline `DATABASE_URL=<prod-url> node scripts/migrate.mjs`, which
works because `dotenv` does not overwrite variables already set in the environment.

Both branches were at the current schema when this landed, so migration `0000` is never
executed. One row was seeded per branch instead:

- tag `0000_friendly_firedrake`
- `created_at` `1787365513752`
- `hash` `e40fb24376e0339078d502eed1197ee8ba08abccffe0d95c72108f526bb9d1ca`

The migrator's skip logic, read from `drizzle-orm/neon-http/migrator.js` at 0.45.2,
compares `created_at` against each journal entry's `when` and ignores `hash` entirely. The
honest hash is stored anyway, so the row survives a version that starts checking it.

Rejected alternatives:

- **A GitHub Action on push to main.** Requires CI built from scratch and a second copy of
  the production credential in GitHub secrets, and the Action races Vercel's deploy, so
  there is no ordering guarantee between "schema migrated" and "new code live". More
  infrastructure for less safety.
- **Migrating at application startup.** In serverless this runs per cold start with real
  concurrency hazards, adds latency to a user request, and surfaces failure as a 500
  rather than a failed deploy — which is the exact failure mode being removed.
- **A build-time divergence check instead of migrations.** Turns the silent 500 into a
  loud build failure, which is an improvement, but still leaves a human running the push.
- **Hand-editing `0000` to be idempotent** so it could run harmlessly on both branches.
  It works, but the first and largest migration in the history would then be a file whose
  SQL does not match what `generate` produced. Seeding a row says the same thing without
  lying in SQL.

## Consequences

- **A schema edit without its generated migration still ships the code.** This is the one
  remaining path to the original outage, and it is worth stating precisely because the
  short version — "the migration file is the change" — understates it. `next build`
  type-checks against `src/db/schema.ts`, not against the database, so the edit compiles;
  `migrate` finds nothing pending and reports matching counts; the deploy goes green; and
  the first query touching the new column 500s. It now takes forgetting one command rather
  than two, and nothing in the pipeline can detect it, because from the outside a schema
  edit with no migration is indistinguishable from no schema change at all.
- Migrations apply during the build, while the previous deployment is still serving, and
  Vercel's rollback reverts code but never schema. Destructive changes therefore take two
  deploys: expand and backfill, then contract once the new code is live.
- **Out-of-order migrations are skipped silently.** Because only the newest applied row is
  read, a migration generated on a long-lived branch and merged after a newer one is never
  applied and never reported. This is the known limitation of the design. It is mitigated
  by a documented "regenerate after rebasing" rule rather than a check, because a real
  check has no home until CI exists.
- Two concurrent production builds both read the same newest row and both attempt the same
  migration; the loser fails on an already-existing object and its build fails. One deploy
  succeeds and nothing is corrupted. Accepted for a single-user app rather than adding an
  advisory lock.
- Preview deploys skip migration entirely and continue to read whatever `DATABASE_URL` is
  scoped to them. Per-preview Neon branches remain out of scope.
- `drizzle-kit` and `dotenv` stay devDependencies: the deploy path uses only the
  programmatic `drizzle-orm` migrator and `@neondatabase/serverless`, both runtime
  dependencies already.
- Local schema iteration is slower by one command, since every change now needs a
  generated file. That is the intended trade — the file is what makes the change
  reviewable and replayable.
- **A failed migration's SQL is echoed into the build log.** Drizzle reports failures as
  `Failed query: <SQL>`, so the statement text appears verbatim. Harmless for DDL, and
  useful when diagnosing — but it means a migration must never embed a literal secret in
  its SQL, because that secret would land in a durable log on failure.
- **A failed migration can leave the schema partially changed.** The `neon-http` migrator
  runs each statement as its own HTTP round-trip with no enclosing transaction, and inserts
  journal rows only after every migration has applied. A failure part-way through therefore
  leaves earlier statements applied and unjournalled, and every later build fails on
  already-existing objects until a human repairs it. Keeping each migration small and
  additive is what limits the blast radius; there is no automatic recovery.
- **Removing `PROD_DATABASE_URL` prevents accidents, not determined access.** Both Neon
  branches share the `neondb_owner` role and therefore the same password, so the dev
  connection string differs from production's only by hostname. What the deletion actually
  buys is that no command can target production by reading a variable, and no routine
  hands anyone a production URL — the class of mistake that caused both outages. It does
  not make production unreachable from a laptop. A separate, lower-privileged dev role
  would buy that; there isn't one today.
- **The guard cannot distinguish a real production deploy from `vercel build --prod` run
  on a laptop.** That command sets `VERCEL_ENV=production` and pulls the production
  `DATABASE_URL` into the build environment, so the "no laptop holds a production
  schema-write credential" property rests on nobody running it, not on the guard. Left as
  is for a single-developer app, recorded here so it is a known property rather than a
  surprise.
