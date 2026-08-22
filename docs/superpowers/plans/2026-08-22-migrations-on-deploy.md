# Automatic Migrations on Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-command manual `drizzle-kit push` routine with committed, versioned migrations that the production Vercel build applies to the production Neon branch by itself.

**Architecture:** `drizzle-kit generate` writes SQL migrations into `drizzle/`, committed with the schema change. `vercel.json` sets the build command to `next build && node scripts/migrate.mjs`. That script consults a pure, unit-tested `shouldMigrate(env)` guard that only permits a run when `VERCEL_ENV === "production"` or when no Vercel environment is present at all, then applies pending migrations with the programmatic `drizzle-orm/neon-http` migrator. Both Neon branches are already at the current schema, so migration `0000` is never executed — one row is seeded into `drizzle.__drizzle_migrations` per branch to declare them baselined. `PROD_DATABASE_URL`, `DRIZZLE_TARGET`, `db:push`, and `db:push:prod` are deleted, so no laptop holds a production schema-write credential.

**Tech Stack:** Next.js 16.3.0 (App Router), Drizzle ORM 0.45.2, drizzle-kit 0.31.10, Neon Postgres (`@neondatabase/serverless`), Vitest 4.1.10, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-22-migrations-on-deploy-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root.

**One deviation from the spec, already reflected below.** The spec's `shouldMigrate`
treats an absent `VERCEL_ENV` as "local, so run". That is unsafe if a Vercel build ever
lacks `VERCEL_ENV`, because it would fall through to running against whatever
`DATABASE_URL` is scoped to that environment. Task 1 therefore also checks `VERCEL`,
which Vercel always sets, and fails closed on Vercel when `VERCEL_ENV` is missing. Same
decision, same default-deny intent, one more guard rail.

A second change came out of Task 1's code review: the guard returns a third field,
`outcome`, and `migrate.mjs` **fails the build** when it is `"unknown"`. The spec's
original "a skip is always a success" rule reasoned about a wrong "yes" and not at all
about a wrong "no" — a production build that skipped quietly would ship code against an
un-migrated schema, which is the outage this replaces. Legitimate previews report
`"skip"` and still exit 0, so nothing normal changed. The spec has been updated to match
both changes.

**Three facts that govern this work:**

1. **The migrator compares timestamps, not hashes.** Verified in
   `node_modules/drizzle-orm/neon-http/migrator.js`: it reads only the newest row from
   `drizzle.__drizzle_migrations` and applies every journal entry whose `when` is greater.
   A migration older than the newest applied row is skipped **silently, with no error**.
2. **Migration `0000` must never run.** It contains `CREATE TABLE` for eight tables that
   already exist on both branches. Tasks 5 and 6 seed a row instead.
3. **Never print a connection string.** They carry passwords and Vercel build logs are
   durable. Log `new URL(url).host` only.

**Verify your local target before Task 5.** Local dev must point at the Neon **dev**
branch:

```bash
grep '^DATABASE_URL=' .env.local | grep -c 'ep-flat-unit-azuxnnpa'   # expect: 1
```

If that prints `0`, stop and ask — you may be pointed at production. The production
endpoint is `ep-wild-sky-azqwwjy9`; it should only ever appear on the `PROD_DATABASE_URL`
line, and only until Task 10 deletes it.

**Confirm a green baseline:**

```bash
npm test
```

Expected: `Test Files  1 passed (1)`, `Tests  79 passed (79)`.

**Check the Vercel environment now, not at the end.** In the Vercel project settings,
confirm `DATABASE_URL` is present for the **Production** environment. This cannot be
verified from the repo, and it is the one thing that will fail the first production build
if it is wrong. Task 10 catches it too, but finding out here costs nothing.

**Current database state**, verified 22 Aug 2026 — both branches carry the same eight
tables (`user`, `account`, `session`, `verificationToken`, `authenticator`, `day_entries`,
`rto_targets`, `wfh_mandates`), the `day_status` enum, and two indexes
(`rto_targets_user_start_idx`, `wfh_mandates_user_start_idx`). Production additionally has
a stray `show_db_tree()` function that drizzle does not manage. Leave it alone.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `scripts/should-migrate.mjs` | The guard, as one pure function. No I/O, no imports |
| `scripts/should-migrate.test.mjs` | Vitest coverage for the guard |
| `scripts/migrate.mjs` | Loads env, applies the guard, runs the programmatic migrator |
| `vercel.json` | Build command wiring migrate into the production build |
| `drizzle/0000_<name>.sql` + `drizzle/meta/` | Generated baseline migration and journal |
| `docs/decisions/0004-migrations-on-deploy.md` | ADR |
| `scratch/baseline.mjs` | One-off baseline seeder. Gitignored (`/scratch`), never committed |
| `scratch/inspect.mjs` | One-off reader for verification. Gitignored |

**Modify:**

| File | Change |
|---|---|
| `drizzle.config.ts` | Collapse to a single `DATABASE_URL`; drop `DRIZZLE_TARGET` |
| `package.json` | `db:push`/`db:push:prod` out; `db:generate`/`db:migrate`/`db:check` in |
| `.env.example` | Remove `PROD_DATABASE_URL`; rewrite the `DATABASE_URL` comment |
| `.env.local` | Remove `PROD_DATABASE_URL` (Task 10, last) |
| `CLAUDE.md:15-16, 27-39` | Replace the commands lines and the whole two-branch section |
| `README.md:42` | `npx drizzle-kit push` → `npm run db:migrate` |
| `docs/architecture.md` | New `## Schema delivery` section |

---

## Task 1: The `shouldMigrate` guard

This is the only thing standing between a preview build and the production database, so
it is written test-first and lives in its own file with no imports.

It returns three fields, not two. `run` says whether to migrate; `outcome` says how the
caller should exit. That distinction exists because **a wrong "no" is as dangerous as a
wrong "yes"** — if a production build skipped quietly, it would ship code against an
un-migrated schema, which is the exact outage this project replaces. A legitimate preview
always carries `VERCEL_ENV=preview`, so refusing an *unrecognized* value costs previews
nothing.

**Files:**
- Create: `scripts/should-migrate.mjs`
- Test: `scripts/should-migrate.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/should-migrate.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { isLocal, shouldMigrate } from "./should-migrate.mjs";

describe("isLocal", () => {
  it("is true when no Vercel variables are present", () => {
    expect(isLocal({})).toBe(true);
  });

  it("is false when VERCEL alone is present", () => {
    expect(isLocal({ VERCEL: "1" })).toBe(false);
  });

  it("is false when VERCEL_ENV alone is present", () => {
    expect(isLocal({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("is false for an empty VERCEL_ENV, which is present but blank", () => {
    expect(isLocal({ VERCEL_ENV: "" })).toBe(false);
  });

  it("treats an inherited VERCEL as on-Vercel, erring toward refusing to migrate", () => {
    expect(isLocal(Object.create({ VERCEL: "1" }))).toBe(false);
  });
});

describe("shouldMigrate — whether it runs", () => {
  it("runs on a laptop, where no Vercel variables exist", () => {
    expect(shouldMigrate({}).run).toBe(true);
  });

  it("runs on a Vercel production deploy", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "production" }).run).toBe(true);
  });

  it("skips a preview build — this is the case that protects production", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview" }).run).toBe(false);
  });

  it("skips a Vercel development build", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "development" }).run).toBe(false);
  });

  it("fails closed on Vercel when VERCEL_ENV is missing entirely", () => {
    expect(shouldMigrate({ VERCEL: "1" }).run).toBe(false);
  });

  it("runs when VERCEL_ENV alone says production", () => {
    expect(shouldMigrate({ VERCEL_ENV: "production" }).run).toBe(true);
  });

  it("treats an empty VERCEL_ENV as present-but-invalid, not as absent", () => {
    expect(shouldMigrate({ VERCEL_ENV: "" }).run).toBe(false);
  });

  it("is case-sensitive, so 'Production' does not pass", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "Production" }).run).toBe(false);
  });
});

describe("shouldMigrate — outcome, which decides whether the build fails", () => {
  it("reports 'local' on a laptop", () => {
    expect(shouldMigrate({}).outcome).toBe("local");
  });

  it("reports 'production' on a production deploy", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "production" }).outcome).toBe("production");
  });

  it("reports 'skip' for a preview, which must stay green", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview" }).outcome).toBe("skip");
  });

  it("reports 'skip' for a development build, which must stay green", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "development" }).outcome).toBe("skip");
  });

  it("reports 'unknown' on Vercel with VERCEL_ENV absent, so the build fails loudly", () => {
    expect(shouldMigrate({ VERCEL: "1" }).outcome).toBe("unknown");
  });

  it("reports 'unknown' for an empty VERCEL_ENV", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "" }).outcome).toBe("unknown");
  });

  it("reports 'unknown' for a wrong-case value rather than silently skipping", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "Production" }).outcome).toBe("unknown");
  });

  it("reports 'unknown' for an environment name Vercel does not define", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "staging" }).outcome).toBe("unknown");
  });
});

describe("shouldMigrate — strictness of the production comparison", () => {
  it("refuses a leading-space value rather than trimming it", () => {
    const decision = shouldMigrate({ VERCEL: "1", VERCEL_ENV: " production" });
    expect(decision.run).toBe(false);
    expect(decision.outcome).toBe("unknown");
  });

  it("refuses a trailing-newline value rather than trimming it", () => {
    const decision = shouldMigrate({ VERCEL: "1", VERCEL_ENV: "production\n" });
    expect(decision.run).toBe(false);
    expect(decision.outcome).toBe("unknown");
  });
});

describe("shouldMigrate — the reason string, which is what a build log shows", () => {
  it("names the offending value on a skip", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview" }).reason).toContain("preview");
  });

  it("says 'unset' when VERCEL_ENV is missing on Vercel", () => {
    expect(shouldMigrate({ VERCEL: "1" }).reason).toContain("unset");
  });

  it("gives a non-empty reason on the local allow path", () => {
    expect(shouldMigrate({}).reason).toMatch(/\S/);
  });

  it("gives a non-empty reason on the production allow path", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "production" }).reason).toMatch(/\S/);
  });

  it("does not claim the local URL came from .env.local, since the emergency path passes one inline", () => {
    expect(shouldMigrate({}).reason).not.toContain(".env.local");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/should-migrate.test.mjs`

Expected: FAIL — `Cannot find module './should-migrate.mjs'`.

If instead vitest reports `No test files found`, its default `include` does not match
`.mjs` here. Fix it by adding `include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"]` to the
`test` block of `vitest.config.ts` and re-run. Do not rename the file to `.js` — the
package has no `"type": "module"`, so `.js` would be treated as CommonJS.

- [ ] **Step 3: Write the implementation**

Create `scripts/should-migrate.mjs`:

```js
/**
 * The Vercel environments that must not migrate. Named for the role rather than for
 * Vercel's catalogue, and deliberately excluding "production" — that is what keeps the
 * branch order in shouldMigrate from being load-bearing. Were "production" in this set,
 * moving the `has` check above the production check would silently classify a real
 * production deploy as a skip: exit 0, deploy green, never migrate.
 *
 * Anything on Vercel that is neither "production" nor in this set is a state this project
 * does not understand, and guessing at it is how a deploy ships code against an
 * un-migrated schema.
 */
const NON_MIGRATING_ENVIRONMENTS = new Set(["preview", "development"]);

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
  if (NON_MIGRATING_ENVIRONMENTS.has(env.VERCEL_ENV)) {
    return { run: false, outcome: "skip", reason: `skipped — VERCEL_ENV=${env.VERCEL_ENV}` };
  }
  return {
    run: false,
    outcome: "unknown",
    reason: `refusing — on Vercel with an unrecognized VERCEL_ENV=${env.VERCEL_ENV ?? "(unset)"}`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/should-migrate.test.mjs`

Expected: `Tests  28 passed (28)`.

- [ ] **Step 5: Confirm the whole suite is still green**

Run: `npm test`

Expected: `Test Files  2 passed (2)`, `Tests  107 passed (107)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/should-migrate.mjs scripts/should-migrate.test.mjs
git commit -m "feat: guard deciding when migrations may run"
```

---

## Task 2: The migrate script

**Files:**
- Create: `scripts/migrate.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/migrate.mjs`:

```js
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
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (leave `db:push` and `db:push:prod` alone for now —
Task 3 removes them):

```json
"db:migrate": "node scripts/migrate.mjs",
```

- [ ] **Step 3: Verify the guard rejects a preview build**

Run: `VERCEL=1 VERCEL_ENV=preview npm run db:migrate`

Expected: prints `[migrate] skipped — VERCEL_ENV=preview` and exits `0`.
It must **not** print a target host — that would mean it got past the guard.

Confirm the exit code explicitly:

```bash
VERCEL=1 VERCEL_ENV=preview npm run db:migrate > /dev/null 2>&1; echo "exit: $?"
```

Expected: `exit: 0`. A skip is a success; preview builds have to go green.

- [ ] **Step 4: Verify it fails loudly with no DATABASE_URL**

Run:

```bash
VERCEL=1 VERCEL_ENV=production node scripts/migrate.mjs; echo "exit: $?"
```

Expected: `[migrate] DATABASE_URL is not set` and `exit: 1`. Setting `VERCEL_ENV`
suppresses the dotenv load, so `.env.local` cannot rescue it — this is exactly the shape
of a Vercel production build with the variable unscoped, and it must fail rather than
deploy.

Do not run the script without `VERCEL_ENV` yet. `drizzle/` does not exist, so it would
fail on a missing journal. Task 5 is the first real run.

- [ ] **Step 5: Verify an unrecognized Vercel environment fails the build**

Run:

```bash
VERCEL=1 node scripts/migrate.mjs; echo "exit: $?"
```

Expected: `[migrate] refusing — on Vercel with an unrecognized VERCEL_ENV=(unset)` and
`exit: 1`. This is the case that must never be a quiet green — a production build that
skipped silently would deploy code against an un-migrated schema.

Confirm a recognized skip still succeeds, so previews are unaffected:

```bash
VERCEL=1 VERCEL_ENV=development node scripts/migrate.mjs; echo "exit: $?"
```

Expected: `[migrate] skipped — VERCEL_ENV=development` and `exit: 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate.mjs package.json
git commit -m "feat: migrate script applying pending migrations"
```

---

## Task 3: Collapse the drizzle config to one URL

**Files:**
- Modify: `drizzle.config.ts`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Rewrite `drizzle.config.ts`**

Replace the whole file:

```ts
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
```

- [ ] **Step 2: Replace the push scripts in `package.json`**

Delete these two lines:

```json
"db:push": "drizzle-kit push",
"db:push:prod": "DRIZZLE_TARGET=prod drizzle-kit push"
```

The `"scripts"` block's database entries should end up exactly:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "node scripts/migrate.mjs",
"db:check": "drizzle-kit check",
```

- [ ] **Step 3: Update `.env.example`**

Replace the first three comment lines and the `PROD_DATABASE_URL` block with:

```
# Neon Postgres connection string for the DEV branch (console.neon.tech → Connect).
# On Vercel this same variable name holds the PRODUCTION branch instead — that is why
# there is only one of them here. Production schema changes are applied by the deploy,
# not from your laptop, so no production credential belongs in this file.
DATABASE_URL=
```

Leave `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` untouched.

- [ ] **Step 4: Verify the config still loads**

Run: `npx drizzle-kit check`

There is no `drizzle/` directory yet, so this may report nothing to check or may complain
that the folder is missing — either is acceptable and neither is the point. What matters
is that it does **not** print `DATABASE_URL is not set in .env.local`. That message would
mean the rewritten config is not reading `.env.local`, and Task 4 would fail next. The
config is properly exercised by `npm run db:generate` in Task 4.

- [ ] **Step 5: Verify the removed scripts are gone**

Run: `npm run db:push 2>&1 | head -3`

Expected: npm reports a missing script. If it runs, Step 2 was not applied.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts package.json .env.example
git commit -m "refactor: one DATABASE_URL, no push scripts"
```

---

## Task 4: Generate the baseline migration

**Files:**
- Create: `drizzle/0000_<name>.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`

- [ ] **Step 1: Generate**

Run: `npm run db:generate`

Expected: it writes `drizzle/0000_<some_generated_name>.sql` plus `drizzle/meta/`. The
name is drizzle's own word pair; whatever it is, use it consistently below.

- [ ] **Step 2: Read the generated SQL and confirm its contents**

Run: `cat drizzle/*.sql`

Confirm it contains, and contains nothing beyond:

- `CREATE TYPE "public"."day_status"` with `office`, `leave`, `holiday`
- `CREATE TABLE` for exactly eight tables: `user`, `account`, `session`,
  `verificationToken`, `authenticator`, `day_entries`, `rto_targets`, `wfh_mandates`
- foreign keys from `account`, `session`, `authenticator`, `day_entries`, `rto_targets`,
  and `wfh_mandates` to `user`
- `CREATE INDEX "rto_targets_user_start_idx"` and `CREATE INDEX "wfh_mandates_user_start_idx"`

Any `DROP` statement means the schema and the databases disagree about something this
plan did not anticipate. **Stop and ask** rather than continuing.

- [ ] **Step 3: Confirm the journal has exactly one entry**

Run: `cat drizzle/meta/_journal.json`

Expected: one object in `entries`, with a `tag` matching the `.sql` filename (without the
extension), a numeric `when`, and `breakpoints`. Note the `when` value — Tasks 5 and 6
insert it.

- [ ] **Step 4: Verify the journal validates**

Run: `npm run db:check`

Expected: exits `0` with no reported collision.

- [ ] **Step 5: Commit**

```bash
git add drizzle
git commit -m "feat: baseline migration for the current schema"
```

---

## Task 5: Baseline the dev branch

Migration `0000` describes tables that already exist. Running it would fail. Instead we
insert the one row that tells the migrator it is already done.

**Files:**
- Create: `scratch/baseline.mjs` (gitignored, never committed)
- Create: `scratch/inspect.mjs` (gitignored, never committed)

- [ ] **Step 1: Write the seeder**

Create `scratch/baseline.mjs`. `/scratch` is already in `.gitignore`, so this never
enters a commit:

```js
import crypto from "node:crypto";
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.TARGET_DATABASE_URL;
if (!url) {
  console.error("TARGET_DATABASE_URL is required");
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
if (journal.entries.length !== 1) {
  console.error(`expected exactly 1 journal entry, found ${journal.entries.length}`);
  process.exit(1);
}

const { tag, when } = journal.entries[0];
// Same hash the migrator computes in node_modules/drizzle-orm/migrator.js: sha256 of the
// whole file. Only `when` drives the skip decision at 0.45.2, but the honest hash is
// stored so the row survives a future version that checks it.
const hash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(`drizzle/${tag}.sql`, "utf8"))
  .digest("hex");

const sql = neon(url);
console.log(`host: ${new URL(url).host}`);
console.log(`tag:  ${tag}`);
console.log(`when: ${when}`);
console.log(`hash: ${hash}`);

await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
await sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
)`;

const [{ n }] = await sql`select count(*)::int as n from "drizzle"."__drizzle_migrations"`;
if (n > 0) {
  console.error(`refusing: table already holds ${n} row(s); this branch is already baselined`);
  process.exit(1);
}

await sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
          values (${hash}, ${when})`;

console.log("seeded:", await sql`select id, hash, created_at from "drizzle"."__drizzle_migrations"`);
```

- [ ] **Step 2: Write the inspector**

Create `scratch/inspect.mjs`:

```js
import { neon } from "@neondatabase/serverless";

const url = process.env.TARGET_DATABASE_URL;
if (!url) {
  console.error("TARGET_DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(url);
console.log(`host: ${new URL(url).host}`);
console.log("migrations:", await sql`select id, created_at from "drizzle"."__drizzle_migrations" order by id`);
console.log(
  "tables:",
  (await sql`select table_name from information_schema.tables
             where table_schema = 'public' order by table_name`).map((r) => r.table_name)
);
```

- [ ] **Step 3: Seed the dev branch**

Dev goes first: it is the branch whose loss costs nothing, and it can be reset from its
parent if this goes wrong.

```bash
TARGET_DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  node scratch/baseline.mjs
```

Expected: `host: ep-flat-unit-azuxnnpa-...`, then the tag, `when`, and hash, then
`seeded:` with exactly one row. If it prints the `refusing:` message, the branch was
already baselined — stop and check with `scratch/inspect.mjs` before doing anything else.

- [ ] **Step 4: Run the real migrate against dev and prove it applies nothing**

Run: `npm run db:migrate`

Expected: `[migrate] local run — applying to DATABASE_URL from .env.local`,
`[migrate] target host: ep-flat-unit-azuxnnpa-...`, `[migrate] schema up to date`, exit
`0`.

This is the proof the baseline took. If the row were missing or its `when` were wrong,
the migrator would attempt `CREATE TABLE "user"` and fail loudly with an already-exists
error.

- [ ] **Step 5: Confirm nothing changed**

```bash
TARGET_DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  node scratch/inspect.mjs
```

Expected: `migrations:` holds exactly one row, and `tables:` lists exactly the eight
known tables — `account`, `authenticator`, `day_entries`, `rto_targets`, `session`,
`user`, `verificationToken`, `wfh_mandates`.

- [ ] **Step 6: Confirm the scratch files are untracked**

Run: `git status --short`

Expected: no `scratch/` entries appear. If they do, `/scratch` is not being honoured —
stop and fix `.gitignore` before committing anything.

There is nothing to commit in this task.

---

## Task 6: Baseline the production branch

**Files:** none created or modified — this is a database operation.

- [ ] **Step 1: Seed production**

```bash
TARGET_DATABASE_URL="$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  node scratch/baseline.mjs
```

Expected: `host: ep-wild-sky-azqwwjy9-...` — **check this host before reading further; if
it says `ep-flat-unit`, you have just re-run dev and it should have refused.** Then the
same tag, `when`, and hash as Task 5, and `seeded:` with one row.

The tag, `when`, and hash **must be identical** to Task 5's, because they are computed
from the same files. If they differ, something regenerated `drizzle/` in between; stop.

- [ ] **Step 2: Verify production**

```bash
TARGET_DATABASE_URL="$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  node scratch/inspect.mjs
```

Expected: one migration row, and the same eight tables.

- [ ] **Step 3: Dry-run the production path without deploying**

```bash
DATABASE_URL="$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  VERCEL=1 VERCEL_ENV=production node scripts/migrate.mjs
```

Expected: `[migrate] Vercel production deploy`, `[migrate] target host:
ep-wild-sky-azqwwjy9-...`, `[migrate] schema up to date`, exit `0`.

This exercises the exact code path the Vercel build will take, against the real
production branch, while there is nothing pending to apply. It also demonstrates the
emergency override — an inline `DATABASE_URL` beating `.env.local` — which only works
because `dotenv` never overwrites an already-set variable.

- [ ] **Step 4: Record the values in the ADR draft**

Note the tag, `when`, and hash somewhere to hand. Task 9 writes them into ADR 0004 so the
baseline is reproducible without these scratch scripts.

There is nothing to commit in this task.

---

## Task 7: Wire the Vercel build

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "framework": "nextjs",
  "buildCommand": "next build && node scripts/migrate.mjs"
}
```

`framework` is stated explicitly because setting `buildCommand` here overrides the
dashboard's build settings, and being declarative about the preset keeps the two from
drifting. Build first, migrate second: a migration should not be applied on behalf of
code that does not compile. A non-zero exit from either half fails the build, and a failed
build is never promoted.

- [ ] **Step 2: Verify the build command locally, end to end**

Run: `npx next build && VERCEL=1 VERCEL_ENV=preview node scripts/migrate.mjs; echo "exit: $?"`

Expected: the Next build completes, then `[migrate] skipped — VERCEL_ENV=preview`, then
`exit: 0`. This is exactly what a preview deploy will do.

- [ ] **Step 3: Confirm the build is not type-checking the scripts**

The build in Step 2 must not report type errors from `scripts/`. `tsconfig.json` includes
`**/*.ts`, `**/*.tsx`, and `**/*.mts` but not `**/*.mjs`, which is why these scripts are
`.mjs`. If a future change adds `scripts/*.ts`, it enters the build's type-check.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat: migrate the production branch during the Vercel build"
```

---

## Task 8: Rewrite the documentation

The existing CLAUDE.md text is an instruction to run two pushes "every time". Leaving any
of it in place leaves the outage reachable, so it is replaced rather than amended.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md:42`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Replace the two `db:push` lines in the CLAUDE.md commands block**

Delete:

```
npm run db:push            # sync src/db/schema.ts to the DEV Neon branch
npm run db:push:prod       # ...and to the PRODUCTION branch — both, every time
```

Insert in their place:

```
npm run db:generate        # src/db/schema.ts → a new migration in drizzle/; commit it
npm run db:migrate         # apply pending migrations to the DEV branch
npm run db:check           # validate the migration journal
```

- [ ] **Step 2: Replace the env paragraph and the whole two-branch section**

Delete everything from `Env lives in \`.env.local\`` through the line ending
`` `npm run db:push` and `npm run db:push:prod` before the work is done.** `` — that is
the paragraph plus the entire bolded block — and write:

```markdown
Env lives in `.env.local` (copy from `.env.example`): `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `drizzle.config.ts` loads `.env.local` explicitly
via dotenv; Next loads it on its own.

**Schema changes travel as committed migrations, and production applies them on deploy.**
One Neon project, two branches. Locally `DATABASE_URL` is the dev branch
(`br-small-salad-az4cwdel`); on Vercel that same variable name is the default
`production` branch (`br-flat-night-azuif9ye`). Nothing on your laptop holds a production
schema-write credential, and nothing needs to.

Editing `src/db/schema.ts` means:

1. `npm run db:generate` — writes `drizzle/NNNN_<name>.sql`. **Read it.** `generate`
   cannot tell a rename from a drop-plus-add and will emit destructive SQL for one.
2. `npm run db:migrate` — applies it to the dev branch.
3. Commit `drizzle/` alongside the schema change. The migration file *is* the change; a
   schema edit without its migration ships nothing.

Production migrates itself: `vercel.json` runs `next build && node scripts/migrate.mjs`,
and `scripts/should-migrate.mjs` lets that through only on `VERCEL_ENV=production`. A
failed migration fails the build, so a deploy never goes live against a schema that did
not migrate. This replaces a two-push routine that took production down twice — with
`rto_targets` after `d93c037`, and with `wfh_mandates` after `431cff2`.

Three rules the mechanism creates:

- **Regenerate after rebasing onto main.** A migration's position is its `when` timestamp
  in `drizzle/meta/_journal.json`, not its filename. The migrator reads only the newest
  applied row and applies whatever is newer, so a migration older than that row is
  skipped **silently, with no error**. After a rebase, delete yours and regenerate it.
- **Expand, then contract, across two deploys.** Migrations apply during the build while
  the previous deployment is still serving, and Vercel's rollback reverts code but never
  schema. Add and backfill in one deploy; drop only once the new code is live.
- **Never `drizzle-kit push`.** It mutates a branch without journalling, so the next
  `migrate` tries to create what is already there and fails. If dev drifts, reset it from
  its parent in the Neon console and migrate forward.
```

- [ ] **Step 3: Update the README**

In `README.md`, replace:

```
npx drizzle-kit push   # creates auth + day_entries tables in Neon
```

with:

```
npm run db:migrate     # creates the tables in your Neon branch
```

- [ ] **Step 4: Add a schema-delivery section to `docs/architecture.md`**

Append:

```markdown
## Schema delivery

`src/db/schema.ts` is the source of truth; `drizzle/` holds the generated migrations that
carry it to a database. `drizzle-kit generate` writes them, they are committed with the
schema change, and the production Vercel build applies whatever is pending via
`scripts/migrate.mjs` before the deployment is promoted. The dev Neon branch is migrated
locally with `npm run db:migrate`. See `docs/decisions/0004-migrations-on-deploy.md`.
```

- [ ] **Step 5: Verify no stale push instructions remain in live docs**

Run:

```bash
grep -rn "db:push\|drizzle-kit push\|PROD_DATABASE_URL\|DRIZZLE_TARGET" \
  CLAUDE.md README.md docs/architecture.md .env.example drizzle.config.ts package.json
```

Expected: no output. Hits in `docs/plans/` and the two older `docs/superpowers/specs/`
files are historical records and are deliberately left alone — do not include those paths
in this check.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/architecture.md
git commit -m "docs: migrations replace the two-push routine"
```

---

## Task 9: Write ADR 0004

**Files:**
- Create: `docs/decisions/0004-migrations-on-deploy.md`

- [ ] **Step 1: Write the ADR**

Match the existing convention — Context, Decision with rejected alternatives, and
Consequences. Substitute the real tag, `when`, and hash recorded in Task 6.

```markdown
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
one variable is correct in both places and no laptop holds a production schema-write
credential. The emergency path is an inline `DATABASE_URL=<prod-url> node
scripts/migrate.mjs`, which works because `dotenv` does not overwrite variables already
set in the environment.

Both branches were at the current schema when this landed, so migration `0000` is never
executed. One row was seeded per branch instead:

- tag `<TAG FROM TASK 6>`
- `created_at` `<WHEN FROM TASK 6>`
- `hash` `<HASH FROM TASK 6>`

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

- A schema edit without its generated migration ships nothing. The migration file is the
  change.
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
- **The guard cannot distinguish a real production deploy from `vercel build --prod` run
  on a laptop.** That command sets `VERCEL_ENV=production` and pulls the production
  `DATABASE_URL` into the build environment, so the "no laptop holds a production
  schema-write credential" property rests on nobody running it, not on the guard. Left as
  is for a single-developer app, recorded here so it is a known property rather than a
  surprise.
```

- [ ] **Step 2: Confirm the placeholders are filled**

Run: `grep -n "FROM TASK 6" docs/decisions/0004-migrations-on-deploy.md`

Expected: no output. If anything matches, substitute the real values from Task 6 before
committing.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0004-migrations-on-deploy.md
git commit -m "docs: ADR for migrations applied by the deploy"
```

---

## Task 10: Remove the production credential and verify the whole thing

Last, because Tasks 5, 6, and 9 read `PROD_DATABASE_URL` from `.env.local`.

**Files:**
- Modify: `.env.local` (untracked; not committed)

- [ ] **Step 1: Delete the `PROD_DATABASE_URL` line from `.env.local`**

Remove the line and the comment block above it. Keep `DATABASE_URL` — that is the dev
branch and local development needs it.

- [ ] **Step 2: Confirm it is gone**

Run: `grep -c 'PROD_DATABASE_URL' .env.local; echo "grep exit: $?"`

Expected: `0` and `grep exit: 1`.

- [ ] **Step 3: Confirm the production endpoint appears nowhere in the repo**

Run: `grep -rn 'ep-wild-sky-azqwwjy9' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next`

Expected: no output.

- [ ] **Step 4: Confirm local migrate still works**

Run: `npm run db:migrate`

Expected: dev host, `[migrate] schema up to date`, exit `0`.

- [ ] **Step 5: Full green check**

```bash
npm test && npm run lint && npx next build
```

Expected: `Tests  107 passed (107)`, eslint clean, build succeeds.

- [ ] **Step 6: Confirm the tree is clean and scratch is untracked**

Run: `git status --short`

Expected: no output. `scratch/` and `.env.local` are both gitignored.

- [ ] **Step 7: Merge and watch the deploy**

Merge `feat/migrations-on-deploy` to `main` and push.

Then, in the Vercel build log for that production deployment, confirm:

- `[migrate] Vercel production deploy`
- `[migrate] target host: ep-wild-sky-azqwwjy9-...`
- `[migrate] schema up to date`

If instead it prints `[migrate] DATABASE_URL is not set`, the variable is not scoped to
the Production environment in Vercel project settings. The build failed rather than
deploying a broken app, which is the design working; scope the variable and redeploy.

- [ ] **Step 8: Confirm the app loads**

Open the deployment and sign in. `/` must render for an authenticated user.

The pipeline is not fully proven until a real migration flows through it. Step 7
establishes that the script runs, reaches production, and reads the journal; the next
genuine schema change establishes that it applies one. No throwaway migration is invented
to force that proof earlier.

---

## Done when

- `npm test` is green with the guard covered by 28 assertions.
- `drizzle/` holds `0000` and its journal, committed.
- Both Neon branches hold exactly one `drizzle.__drizzle_migrations` row with identical
  `hash` and `created_at`.
- `db:push` and `db:push:prod` no longer exist; `PROD_DATABASE_URL` and `DRIZZLE_TARGET`
  appear nowhere in the repo or in `.env.local`.
- A production build log shows the migrate step reaching the production host.
- `CLAUDE.md` no longer tells anyone to push to two branches.
