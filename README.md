# RTO Tracker

Personal return-to-office attendance record. Stamp the weekdays you were in the
office; the app tracks whether you're meeting the 40% monthly requirement.
Unmarked weekdays count as work from home; leaves, holidays, and mandated
work-from-home periods are excluded from the computation.

Stack: Next.js (App Router) · Drizzle ORM · Neon Postgres · Auth.js v5
(Google OAuth). See `docs/architecture.md` and `docs/decisions/` for design
rationale, and `docs/plans/` for the build plan.

## Setup

### 1. Neon database

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Copy the connection string (Connect → Postgres).

### 2. Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com), create (or
   pick) a project → APIs & Services → Credentials → Create Credentials →
   OAuth client ID → Web application.
2. Add authorized redirect URI:
   `http://localhost:3000/api/auth/callback/google`
   (add your production URL later: `https://<your-domain>/api/auth/callback/google`)
3. Copy the client ID and secret.

### 3. Environment

```bash
cp .env.example .env.local
npx auth secret   # fills AUTH_SECRET, or paste its output manually
```

Fill in `DATABASE_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.

### 4. Create tables and run

```bash
npm install
npx drizzle-kit push   # creates auth + day_entries tables in Neon
npm run dev
```

Open http://localhost:3000, sign in with Google, tap days.

The 40% requirement is the default. If your policy changed for a stretch of months
(ours dropped to 20% during a fuel price spike), record that range under **Settings** and
those months are scored at the lower rate — including retroactively.

Business-mandated work-from-home periods go in the same place, as date ranges —
leave the end date blank while the mandate is open-ended.

## Verify

```bash
make test   # vitest unit tests (RTO computation)
make lint   # eslint
```

## Deploy (Vercel)

1. Push this repo to GitHub and import it in [vercel.com](https://vercel.com).
2. Add environment variables in the Vercel project settings: `DATABASE_URL`,
   `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
3. Add the production redirect URI to the Google OAuth client:
   `https://<your-vercel-domain>/api/auth/callback/google`
4. Deploy. Auth.js infers the canonical URL from Vercel automatically.
