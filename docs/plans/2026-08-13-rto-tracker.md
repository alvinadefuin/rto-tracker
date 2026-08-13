# RTO Tracker — Implementation Plan (2026-08-13)

Approved design: Next.js (App Router) + Drizzle + Neon Postgres on Vercel. Auth.js v5
with Google OAuth (Drizzle adapter, database sessions). One data table `day_entries`
(user_id, date, status: office|leave|holiday); unmarked weekday = WFH. Month-view
calendar, tap weekday to cycle WFH → Office → Leave → Holiday → WFH. Monthly 40% RTO
target over eligible weekdays (weekdays − holidays − leaves), per-week breakdown.
Dates are `YYYY-MM-DD` strings end-to-end.

## Blockers requiring user input (surface before Tasks 3–4)

1. **Neon**: user creates a Neon project and provides `DATABASE_URL`.
2. **Google OAuth**: user creates OAuth client in Google Cloud Console
   (redirect URI `http://localhost:3000/api/auth/callback/google` for dev) and
   provides `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

Tasks 1–2 are fully verifiable offline.

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, etc. | create-next-app scaffold (TS, Tailwind, App Router, src dir) |
| `Makefile` | `make test` → `npm test`, `make lint` → `npm run lint` |
| `vitest.config.ts` | Vitest config (node env, `@/` alias) |
| `docs/architecture.md` | High-level design (stack, data model, computation rules) |
| `docs/decisions/0001-stack.md` | ADR: Next.js + Neon + Auth.js; dates as text |
| `src/lib/rto.ts` | Pure date/stats logic: `monthWeekdays`, `computeMonthStats`, types |
| `src/lib/rto.test.ts` | Vitest tests for the above |
| `src/db/schema.ts` | Drizzle schema: `users`, `accounts`, `sessions`, `verificationTokens`, `dayEntries` |
| `src/db/index.ts` | Neon serverless driver + drizzle client |
| `drizzle.config.ts` | drizzle-kit config |
| `src/auth.ts` | NextAuth config: Google provider + DrizzleAdapter |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `src/app/actions.ts` | Server action `setDayStatus(date, status \| null)` (auth-checked, validated) |
| `src/app/page.tsx` | Server component: auth gate, fetch month entries, render dashboard + calendar |
| `src/app/signin/page.tsx` | Sign-in page (Google button) |
| `src/components/calendar.tsx` | Client component: month grid, tap-to-cycle, optimistic state, month nav |
| `src/components/stats.tsx` | Monthly % / days-needed / per-week strip |
| `src/components/toast.tsx` | Minimal self-made toast (no dependency) |
| `.env.example` | Documented env vars, no secrets |
| `README.md` | Setup + deploy (Vercel) instructions |

## Task 1: Scaffold + tooling

**Files:** Create: scaffold via `create-next-app`, `Makefile`, `vitest.config.ts`,
`docs/architecture.md`, `docs/decisions/0001-stack.md`

- [ ] `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --turbopack` (in repo root; accept `@/*` alias)
- [ ] `npm i -D vitest`
- [ ] Add `"test": "vitest run"` script; create `vitest.config.ts` with `@/` alias resolving to `./src`
- [ ] Create `Makefile`:
  ```makefile
  test:
  	npm test
  lint:
  	npm run lint
  ```
- [ ] Write `docs/architecture.md` and `docs/decisions/0001-stack.md`
- [ ] Verify: `npm run lint` (clean), `npm run build` (succeeds), `npm test` (0 tests, exits 0 with `--passWithNoTests` or a placeholder — remove placeholder in Task 2)
- [ ] Commit: `git commit -m "chore: scaffold Next.js app with vitest and docs"`

## Task 2: RTO computation module (TDD)

**Files:** Create: `src/lib/rto.ts`, `src/lib/rto.test.ts`

Types and contract:

```ts
export type DayStatus = "office" | "leave" | "holiday";
export type Entries = Record<string, DayStatus>; // key: 'YYYY-MM-DD'

export interface WeekStats {
  start: string; // first weekday of the chunk (YYYY-MM-DD)
  end: string;   // last weekday of the chunk
  eligibleDays: number;
  officeDays: number;
}

export interface MonthStats {
  eligibleDays: number;    // weekdays − holidays − leaves
  officeDays: number;
  requiredDays: number;    // Math.ceil(0.4 * eligibleDays)
  remainingNeeded: number; // Math.max(0, requiredDays − officeDays)
  percent: number;         // officeDays / eligibleDays (0 when eligibleDays === 0)
  weeks: WeekStats[];      // Mon–Fri chunks; partial at month edges
}

export function monthWeekdays(year: number, month: number): string[]; // month 1–12
export function isWeekend(date: string): boolean;
export function computeMonthStats(year: number, month: number, entries: Entries): MonthStats;
```

- [ ] Write failing tests (`src/lib/rto.test.ts`):

  ```ts
  import { describe, it, expect } from "vitest";
  import { computeMonthStats, monthWeekdays, isWeekend } from "./rto";

  // Jan 2026: 31 days, starts Thu, 22 weekdays. ceil(0.4*22)=9.
  describe("monthWeekdays", () => {
    it("returns 22 weekdays for Jan 2026", () => {
      const days = monthWeekdays(2026, 1);
      expect(days).toHaveLength(22);
      expect(days[0]).toBe("2026-01-01"); // Thu
      expect(days[1]).toBe("2026-01-02"); // Fri
      expect(days[2]).toBe("2026-01-05"); // Mon (skips weekend)
    });
  });

  describe("isWeekend", () => {
    it("flags Sat/Sun only", () => {
      expect(isWeekend("2026-01-03")).toBe(true);  // Sat
      expect(isWeekend("2026-01-04")).toBe(true);  // Sun
      expect(isWeekend("2026-01-05")).toBe(false); // Mon
    });
  });

  describe("computeMonthStats", () => {
    it("empty month: all weekdays eligible, 40% target rounded up", () => {
      const s = computeMonthStats(2026, 1, {});
      expect(s.eligibleDays).toBe(22);
      expect(s.officeDays).toBe(0);
      expect(s.requiredDays).toBe(9); // ceil(8.8)
      expect(s.remainingNeeded).toBe(9);
      expect(s.percent).toBe(0);
    });

    it("holidays and leaves reduce eligible days and the target", () => {
      const s = computeMonthStats(2026, 1, {
        "2026-01-01": "holiday",
        "2026-01-02": "leave",
      });
      expect(s.eligibleDays).toBe(20);
      expect(s.requiredDays).toBe(8); // ceil(0.4*20)
    });

    it("office days count toward percent", () => {
      const s = computeMonthStats(2026, 1, {
        "2026-01-05": "office",
        "2026-01-06": "office",
      });
      expect(s.officeDays).toBe(2);
      expect(s.percent).toBeCloseTo(2 / 22);
      expect(s.remainingNeeded).toBe(7);
    });

    it("ignores weekend entries defensively", () => {
      const s = computeMonthStats(2026, 1, { "2026-01-03": "office" }); // Sat
      expect(s.officeDays).toBe(0);
      expect(s.eligibleDays).toBe(22);
    });

    it("splits weeks at Mon boundaries with partial edges", () => {
      const s = computeMonthStats(2026, 1, {});
      // Jan 2026 starts Thu → first chunk is Thu 1 – Fri 2
      expect(s.weeks[0]).toMatchObject({
        start: "2026-01-01", end: "2026-01-02", eligibleDays: 2, officeDays: 0,
      });
      expect(s.weeks[1].start).toBe("2026-01-05");
      expect(s.weeks.at(-1)!.end).toBe("2026-01-30"); // Fri 30 (31st is Sat)
    });

    it("all days on leave: zero eligible, zero required, percent 0", () => {
      const entries: Record<string, "leave"> = {};
      for (const d of monthWeekdays(2026, 1)) entries[d] = "leave";
      const s = computeMonthStats(2026, 1, entries);
      expect(s.eligibleDays).toBe(0);
      expect(s.requiredDays).toBe(0);
      expect(s.percent).toBe(0); // no divide-by-zero
    });
  });
  ```

- [ ] `npm test` — watch fail (expected: `Cannot find module './rto'` / undefined exports)
- [ ] Implement `src/lib/rto.ts` with pure string/UTC date math (no `new Date(str)` local-TZ parsing; use `Date.UTC` components only)
- [ ] `npm test` — all pass
- [ ] Commit: `git commit -m "feat: RTO monthly stats computation"`

## Task 3: Database schema + Neon connection

**Files:** Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `.env.example`
**Blocker:** needs `DATABASE_URL` from user.

- [ ] `npm i drizzle-orm @neondatabase/serverless && npm i -D drizzle-kit`
- [ ] `src/db/schema.ts`: standard Auth.js Drizzle pg tables (`users`, `accounts`, `sessions`, `verificationTokens`) plus:

  ```ts
  export const dayStatusEnum = pgEnum("day_status", ["office", "leave", "holiday"]);

  export const dayEntries = pgTable(
    "day_entries",
    {
      userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      date: text("date").notNull(), // YYYY-MM-DD; text avoids TZ drift
      status: dayStatusEnum("status").notNull(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.date] })]
  );
  ```

- [ ] `src/db/index.ts`: `drizzle(neon(process.env.DATABASE_URL!))` with schema
- [ ] `drizzle.config.ts` pointing at `src/db/schema.ts`, dialect `postgresql`
- [ ] `.env.example` with `DATABASE_URL=`, `AUTH_SECRET=`, `AUTH_GOOGLE_ID=`, `AUTH_GOOGLE_SECRET=`
- [ ] `npx drizzle-kit push` against the user-provided Neon URL; verify tables exist (`npx drizzle-kit studio` or a select)
- [ ] Verify: `npm run build` clean
- [ ] Commit: `git commit -m "feat: drizzle schema and neon connection"`

## Task 4: Google OAuth via Auth.js v5

**Files:** Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/signin/page.tsx`
**Blocker:** needs Google OAuth client ID/secret from user; `npx auth secret` for `AUTH_SECRET`.

- [ ] `npm i next-auth@beta @auth/drizzle-adapter`
- [ ] `src/auth.ts`:

  ```ts
  import NextAuth from "next-auth";
  import Google from "next-auth/providers/google";
  import { DrizzleAdapter } from "@auth/drizzle-adapter";
  import { db } from "@/db";
  import { users, accounts, sessions, verificationTokens } from "@/db/schema";

  export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers: [Google],
    pages: { signIn: "/signin" },
  });
  ```

- [ ] Route handler re-exporting `handlers` (GET/POST)
- [ ] `/signin` page with a server-action Google sign-in button
- [ ] Verify manually: `npm run dev`, sign in with Google, confirm a `users` row appears in Neon
- [ ] Commit: `git commit -m "feat: google oauth with authjs and drizzle adapter"`

## Task 5: Day-entry server action + data fetch

**Files:** Create: `src/app/actions.ts`; Modify: `src/app/page.tsx`

- [ ] `setDayStatus(date: string, status: DayStatus | null)`:
  - `auth()` → throw if no session
  - validate `date` matches `/^\d{4}-\d{2}-\d{2}$/`, reject weekends via `isWeekend`
  - validate `status` ∈ enum or null
  - null → `delete`; else upsert (`insert … onConflictDoUpdate` on `(user_id, date)`)
- [ ] `page.tsx`: `auth()` gate (redirect `/signin`), query month's entries for the session user, pass to calendar
- [ ] Verify: manual dev-server round trip — mark a day, reload, mark persists; check row in DB
- [ ] Commit: `git commit -m "feat: day status server action and month fetch"`

## Task 6: Calendar UI + dashboard

**Files:** Create: `src/components/calendar.tsx`, `src/components/stats.tsx`, `src/components/toast.tsx`; Modify: `src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`

- [ ] **Invoke `frontend-design` skill before writing any UI code** — deliberate palette/typography, no AI-template look
- [ ] Month grid (Mon-first columns), weekends visually muted and non-interactive
- [ ] Tap weekday cycles WFH → Office → Leave → Holiday → WFH; distinct visual treatment per status
- [ ] Optimistic update via `useOptimistic`/local state; on action failure revert cell + toast
- [ ] Month navigation (prev/next), stats header: monthly %, progress vs 40%, "X more office days needed", per-week strip from `MonthStats.weeks`
- [ ] Sign-out affordance in header
- [ ] Verify: `npm run lint`, `npm run build`, `npm test` all clean; manual check in browser (desktop + narrow viewport)
- [ ] Commit: `git commit -m "feat: calendar ui and rto dashboard"`

## Task 7: README + deploy

**Files:** Create: `README.md`; Modify: `.env.example` (final check)

- [ ] README: local setup, env vars, drizzle push, Vercel deploy steps (add env vars, set Google redirect URI for prod domain)
- [ ] Final verification: `make test`, `make lint`, `npm run build` all clean
- [ ] Commit: `git commit -m "docs: readme with setup and deploy"`

## Self-review

- Every design element maps to a task (calendar ✓, cycle interaction ✓, 40% monthly + weekly strip ✓, holidays/leaves ✓, Google OAuth in DB ✓, optimistic + toast ✓, non-AI UI via frontend-design ✓).
- No TBDs; type names (`DayStatus`, `MonthStats`, `dayEntries`) consistent across tasks.
- Tasks 1–2 independently verifiable; 3–4 blocked on user-provided credentials.
