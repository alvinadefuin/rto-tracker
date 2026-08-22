/**
 * Decide whether this process may apply migrations.
 *
 * Default-deny. The only permitted runs are a Vercel *production* deploy and a machine
 * with no Vercel environment at all (a laptop, targeting the dev branch). Every other
 * shape — preview, development, or Vercel with VERCEL_ENV somehow absent — is refused,
 * because the cost of a wrong "yes" is writing to the production database.
 *
 * Pure: reads the object it is given, touches nothing else.
 *
 * @param {{ VERCEL?: string, VERCEL_ENV?: string }} env
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldMigrate(env) {
  const onVercel = env.VERCEL !== undefined || env.VERCEL_ENV !== undefined;

  if (!onVercel) {
    return { run: true, reason: "local run — applying to DATABASE_URL from .env.local" };
  }
  if (env.VERCEL_ENV === "production") {
    return { run: true, reason: "Vercel production deploy" };
  }
  return {
    run: false,
    reason: `skipped — on Vercel with VERCEL_ENV=${env.VERCEL_ENV ?? "(unset)"}`,
  };
}
