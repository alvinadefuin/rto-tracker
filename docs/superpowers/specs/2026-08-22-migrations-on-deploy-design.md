# Automatic database migrations on deploy — design

Date: 2026-08-22
Branch: `feat/migrations-on-deploy`
Status: in review

## Problem

Schema changes reach the two Neon branches by hand. `npm run db:push` targets dev,
`npm run db:push:prod` targets the branch Vercel reads, and nothing connects either to
a deploy. There is no migrations directory, so nothing reconciles the branches and
nothing fails at build time.

The failure mode is silent and total. A table pushed to dev but not prod compiles,
type-checks, passes tests, deploys green, and then 500s the first authenticated request
that touches it. CLAUDE.md already records this happening once, with `rto_targets` after
`d93c037`. It happened again on 22 Aug 2026: `wfh_mandates` merged in `431cff2`, went to
dev only, and every authenticated render of `/` failed because `src/app/page.tsx:87`
selects from a table production did not have.

Both incidents share one cause: **the step that makes production correct is a human
remembering to run a second command.** Documentation has already been tried — the
warning in CLAUDE.md is emphatic, in bold, with the previous outage named in it, and the
outage recurred anyway five days after the mandate spec was written. The spec that
shipped `wfh_mandates` even ends with "Schema goes out with `npx drizzle-kit push`",
which is exactly the instruction that took production down.

So the fix cannot be a better reminder. The deploy has to carry the schema change.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Schema delivery | Versioned migration files, committed | A deploy can only apply what is in the repo. `push` diffs against a live DB and leaves no artifact to replay |
| Where migrations run | Vercel build command, guarded on `VERCEL_ENV` | No new infrastructure, no second copy of the prod credential, exactly once per production deploy. Failure fails the build, so nothing ships against a schema that did not migrate |
| Which deploys migrate | Production only | A preview build must never write to prod. Previews skip entirely; dev stays a manual local migrate |
| Migrator | Programmatic `drizzle-orm/neon-http/migrator` | Its skip logic is verified below by reading the source. It also keeps the deploy path free of devDependencies — `drizzle-orm` and `@neondatabase/serverless` are already runtime dependencies, while `drizzle-kit` and `dotenv` are dev-only |
| Order within the build | `next build` first, then migrate | A migration should not be applied for code that does not compile. Both orderings run before the deployment serves traffic, so neither is less safe |
| `PROD_DATABASE_URL` / `DRIZZLE_TARGET` | Deleted | On Vercel `DATABASE_URL` *is* prod; locally it is dev. One variable is already correct in both places. The laptop stops holding prod schema-write credentials, which removes the footgun rather than documenting around it |
| `db:push` / `db:push:prod` | Deleted | Keeping them keeps the outage reachable. Mixing `push` with a migration journal also drifts the dev branch away from what migrations reproduce |
| Baseline | One row seeded into the migrations table on both branches | Both DBs are already at the current schema. Declaring them at 0000 is honest and applies nothing |
| Guard logic | Pure `shouldMigrate(env)`, unit-tested | It is the single thing standing between a preview build and the production database. That deserves a test |

## How the migrator actually decides — verified, not assumed

Read from `node_modules/drizzle-orm/neon-http/migrator.js` at drizzle-orm 0.45.2. The
design depends on this, so it is recorded rather than trusted to memory.

```js
const dbMigrations = await db.session.all(
  sql`select id, hash, created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`
);
const lastDbMigration = dbMigrations[0];
for await (const migration of migrations) {
  if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
    // apply, then insert (hash, created_at)
  }
}
```

Three consequences follow, and each one shapes a decision in this spec.

1. **The decision is a timestamp comparison, not a hash match.** `hash` is recorded but
   never read for the skip decision. `folderMillis` is the `when` field of the entry in
   `drizzle/meta/_journal.json`.
2. **Only the newest row is read.** Seeding a single row therefore marks everything up to
   that timestamp as applied. This is what makes baselining a one-row insert rather than
   a hash-forging exercise.
3. **Out-of-order migrations are skipped silently.** A migration generated on a
   long-lived branch and merged after a newer one has a smaller `when` than the newest
   applied row, so it is never applied and never reported. This is a real hazard for a
   repo that works on feature branches, and it gets a workflow rule below.

The migrations table it creates, reproduced verbatim because the baseline insert must
match it:

```sql
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
```

Statements within a migration file are split on `--> statement-breakpoint`.

## Starting state

Verified against the Neon project `holy-dew-14569649` on 22 Aug 2026, after the outage
repair:

- `production` — `br-flat-night-azuif9ye`, default branch, the one Vercel reads.
- `dev` — `br-small-salad-az4cwdel`, `parent_id` = production.
- Both branches now carry identical tables: `user`, `account`, `session`,
  `verificationToken`, `authenticator`, `day_entries`, `rto_targets`, `wfh_mandates`.
- The only schema difference is a stray `show_db_tree()` function on production. Drizzle
  does not manage functions, so it is inert and will not be dropped. It is left alone.

Identical branches are the precondition that makes a single shared baseline honest.

## Baseline

`drizzle-kit generate` against the current `src/db/schema.ts` produces the flat layout
the migrator reads:

```
drizzle/
  0000_<name>.sql
  meta/
    _journal.json
    0000_snapshot.json
```

`0000_<name>.sql` will contain `CREATE TABLE` for every table that already exists on
both branches. It must therefore **never be executed**. Instead, one row is inserted per
branch, declaring that DB to be at 0000:

```sql
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
VALUES ('<hex sha256 of 0000_<name>.sql>', <"when" from _journal.json>);
```

`created_at` is the `when` value of the 0000 entry in `_journal.json`. `hash` is the
hex sha256 of the whole `0000_<name>.sql` file — the same value
`crypto.createHash("sha256").update(query).digest("hex")` produces in
`node_modules/drizzle-orm/migrator.js`.

Only `created_at` affects the skip decision at 0.45.2, but the real hash is inserted
anyway so the row stays correct if a future drizzle version starts checking it.

This is a one-off performed from a scratch script, not committed. The exact SQL, the
computed hash, and the `when` value are recorded in ADR 0004 so the step is reproducible
without the script existing.

Alternatives rejected:

- **Hand-editing 0000 to be idempotent** (`CREATE TABLE IF NOT EXISTS`, `DO $$ ... EXCEPTION
  WHEN duplicate_object` around each FK) so it can run harmlessly on both. It works, but
  it means the first and largest migration in the history is a hand-edited file whose SQL
  does not match what `generate` produced, and every future reader has to be told why.
  Seeding a row says the same thing without lying in SQL.
- **Two migrations, 0000 pre-mandate and 0001 adding `wfh_mandates`.** This would have
  been the honest history had the outage not already been repaired by hand. Now that both
  branches have the table, 0001 would have to be skipped on both, which is the same
  seeding exercise with an extra file.

## The migrate script

`scripts/migrate.mjs`, plain ESM, plus `scripts/should-migrate.mjs` holding the guard as
a pure function.

```js
/**
 * @param {{ VERCEL_ENV?: string }} env
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldMigrate(env) {
  if (env.VERCEL_ENV === undefined) {
    return { run: true, reason: "no VERCEL_ENV — local run, targeting DATABASE_URL" };
  }
  if (env.VERCEL_ENV === "production") {
    return { run: true, reason: "production deploy" };
  }
  return { run: false, reason: `skipped — VERCEL_ENV=${env.VERCEL_ENV}` };
}
```

Default-deny on anything that is neither production nor absent. `VERCEL_ENV` is
`production`, `preview`, or `development` on Vercel and unset on a laptop, so a preview
build cannot reach production no matter how `DATABASE_URL` is scoped.

One benign edge, worth knowing rather than verified in this repo: `vercel env pull` is
reported to write `VERCEL_ENV="development"` into `.env.local`. A laptop that has run it
would *skip* rather than migrate, and print the reason. Failing closed is the right
direction, and the printed reason explains itself. Worth confirming during
implementation, since it changes nothing if true and nothing if false.

`scripts/migrate.mjs` then:

1. Loads `.env.local` **only when running locally**, via a dynamic
   `await import("dotenv")` guarded by the same absent-`VERCEL_ENV` check. `dotenv` is a
   devDependency, so a top-level import would make the production build path depend on a
   dev-only package; the dynamic guarded form keeps the deploy path free of every
   devDependency. On Vercel the variables are already in the environment.
2. Calls `shouldMigrate(process.env)`; logs the reason and exits 0 when `run` is false.
   A skip is a success, not a failure — preview builds must go green.
3. Requires `DATABASE_URL` and exits non-zero with a named error if absent, matching the
   existing message style in `drizzle.config.ts`.
4. Logs the target host — **host only, never the full URL**, which carries the password
   and would land in a Vercel build log.
5. Runs `migrate(db, { migrationsFolder: "./drizzle" })` against a `neon-http` client.
6. Logs completion and exits non-zero on any thrown error, failing the build.

Plain `.mjs` rather than TypeScript is deliberate: `tsconfig.json` includes `**/*.ts` and
`**/*.mts`, so a TS script under `scripts/` would enter `next build`'s type-check, while
`.mjs` is excluded (`allowJs` is on but `**/*.mjs` is not in `include`). It also avoids
adding `tsx` as a build-time dependency.

## Vercel wiring

`vercel.json` at the repo root:

```json
{
  "buildCommand": "next build && node scripts/migrate.mjs"
}
```

Version-controlled rather than typed into the Vercel dashboard, so the deploy behaviour
is reviewable in a diff and cannot silently differ from the repo.

A non-zero exit from either half fails the build, and a failed build is not promoted, so
production keeps serving the previous deployment against the previous schema.

## Workflow rules

These are the sharp edges the mechanism creates. All three go into CLAUDE.md, because
they are the kind of thing that has already cost this project an outage once.

**Regenerate after rebasing onto main.** A migration's position is its `when` timestamp,
not its filename order. If you generate on a branch, then main gains a newer migration
before you merge, yours is older than the newest applied row and will be skipped in
silence. After rebasing, delete your generated migration and regenerate it so it lands
above whatever main has.

**Read the generated SQL before committing it.** `generate` cannot tell a rename from a
drop-plus-add and will emit destructive SQL for one. The SQL is the artifact that runs
against production; it gets read like any other code.

**Expand then contract, across two deploys.** The migration is applied during the build,
while the previous deployment is still serving. Every migration must therefore be safe
against the *previous* code as well as the new code. Additive changes are. Dropping or
narrowing anything takes two deploys: add and backfill first, remove only after the new
code is live. This also matters for Vercel's instant rollback, which reverts code but
never reverts schema.

**Do not mix `push` with migrations.** `push` mutates a branch without journalling, so a
later `migrate` tries to create what is already there and fails. If dev is ever drifted
by an experiment, recover by resetting the dev branch from its parent — dev's
`parent_id` is production — and then migrating it forward.

## Failure modes

| Situation | Result |
|---|---|
| Migration SQL fails on prod | Build fails, deploy not promoted, previous deployment and previous schema keep serving |
| `next build` fails | Migrate never runs; schema untouched |
| `DATABASE_URL` missing in the production build | Build fails loudly with a named variable, instead of deploying and 500ing later |
| Preview build | Skips, logs the reason, exits 0, deploys green |
| Two production builds race | Both read the same newest row and both apply the same migration; the loser errors on an already-existing object and its build fails. One deploy succeeds, no corruption. Accepted for a single-user app rather than adding an advisory lock |
| Migration generated out of order | **Silently skipped.** No error. Mitigated only by the regenerate-after-rebase rule, which is why that rule is documented rather than assumed |
| Deploy rolled back after a contract migration | Schema stays migrated, old code meets a changed schema. Prevented by the expand/contract rule, not by the mechanism |

The out-of-order row is the one genuinely unguarded hazard in this design. It is
accepted here because the alternative — validating that every journal entry is newer
than the last applied row — is a check with no natural home until a CI step exists.
It is called out in ADR 0004 as the known limitation.

## Config and script changes

`drizzle.config.ts` collapses to a single URL and keeps `out: "./drizzle"`:

```ts
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set in .env.local");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
```

`package.json` scripts:

```
db:generate  drizzle-kit generate      # after editing schema.ts; commit the output
db:migrate   node scripts/migrate.mjs  # locally: applies to the dev branch
db:check     drizzle-kit check         # journal consistency
```

`db:push` and `db:push:prod` are removed.

The emergency path — applying a migration to production from a laptop — is not a script
and not a stored variable. It is `DATABASE_URL=<prod-url> node scripts/migrate.mjs` with
the URL pasted for that one invocation, documented in the ADR. Keeping it out of
`.env.local` is the point.

This works because `dotenv` does not overwrite variables already present in the
environment: the inline `DATABASE_URL` wins over the dev URL in `.env.local`. That
precedence is load-bearing for the emergency path, so the implementation must not pass
`override: true`, and a test-by-inspection of this behaviour belongs in the rollout.

## Testing

`scripts/should-migrate.test.mjs`, discovered by vitest's default include patterns and
running in the existing `node` environment. No new dependencies.

- `VERCEL_ENV` absent → `run: true`
- `VERCEL_ENV: "production"` → `run: true`
- `VERCEL_ENV: "preview"` → `run: false` — the case that protects production
- `VERCEL_ENV: "development"` → `run: false`
- `VERCEL_ENV: ""` → `run: false`, proving the check is not truthiness
- `VERCEL_ENV: "Production"` → `run: false`, proving it is not case-folded
- the `reason` string names the offending value on every skip, so a build log explains
  itself

This is a documented extension of the convention that only `src/lib/rto.ts` is
unit-tested. The guard is not domain logic, but it is the only thing preventing a
preview build from writing to production, so it is tested where it lives rather than
moved into `src/lib` to satisfy the convention.

`scripts/migrate.mjs` itself is not unit-tested. It is I/O against a real database, and
a mocked migrator would assert only that the mock was called.

## Documentation

- **`CLAUDE.md`** — the database section is rewritten, not amended. The current text is
  an instruction to run two pushes "every time", and leaving any of it in place leaves
  the outage reachable. Replaced by: schema changes are versioned migrations, generated
  and committed; production migrates itself on deploy; the dev branch is migrated locally;
  and the three workflow rules above. The `PROD_DATABASE_URL` paragraph goes entirely.
- **`.env.example`** — `PROD_DATABASE_URL` removed; the `DATABASE_URL` comment updated to
  say it is the dev branch locally and the prod branch on Vercel.
- **`README.md:42`** — `npx drizzle-kit push` in the setup steps becomes
  `npm run db:migrate`.
- **`docs/architecture.md`** — a short note that schema reaches production through the
  build.
- **`docs/decisions/0004-migrations-on-deploy.md`** — new ADR, matching the existing
  convention: the recurrence of the outage as context; build-command migration chosen
  over GitHub Actions and over startup migration; the verified migrator semantics; the
  baseline values actually used; and the out-of-order hazard as the known limitation.

The three older documents that say `drizzle-kit push` — the two shipped specs and
`docs/plans/2026-08-13-rto-tracker.md` — are historical records of decisions made at the
time and are left as they are.

## Rollout

Ordered, because several steps are only safe in this order.

1. Confirm `DATABASE_URL` is present for Vercel's **Production** environment and visible
   at build time. If it is not, the first production build fails at the script's
   `DATABASE_URL` check — loudly, which is the intended behaviour, but better known in
   advance.
2. `npm run db:generate` → `drizzle/0000_<name>.sql` + `meta/`. Read the SQL and confirm
   it describes exactly the eight current tables (`user`, `account`, `session`,
   `verificationToken`, `authenticator`, `day_entries`, `rto_targets`, `wfh_mandates`),
   the `day_status` enum, and the two `*_user_start_idx` indexes, and nothing else.
3. Seed the baseline row on **dev** first, then on **production**. Dev is the branch
   whose loss costs nothing, so a mistake in the hash or the `when` value surfaces
   somewhere recoverable — and dev can be reset from its parent if it does. Record both
   values in ADR 0004.
4. `npm run db:migrate` against dev → expect it to apply nothing. Confirm via Neon that
   dev's tables are unchanged. This is the proof the baseline took.
5. Commit `drizzle/`, `vercel.json`, the scripts, the config and package changes, and the
   docs. Merge to main.
6. Watch the production build log for the migrate step: it should report zero pending
   migrations against the prod host. That confirms the wiring end to end without
   requiring a schema change.
7. Confirm `/` loads for an authenticated user.

The pipeline is not fully proven until a real migration flows through it. Step 6
establishes that the script runs, finds production, and reads the journal; the first
genuine schema change establishes that it applies one. No throwaway migration is invented
to force that proof earlier.

## Out of scope

- Per-preview Neon branches. Previews continue to read whatever `DATABASE_URL` is scoped
  to them, which is existing behaviour and unchanged by this work.
- An advisory lock serialising concurrent production builds. The race is understood above
  and its worst outcome is one failed build.
- CI. No `.github/workflows` exists, and adding it to host an out-of-order check is a
  larger decision than this spec.
- Automatic rollback of a migration. Contract migrations are made safe by the
  expand/contract rule, not by reversal.
- Seed or fixture data.
- Backfills. None is needed; no existing row changes shape.
