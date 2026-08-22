/**
 * Render an unknown thrown value as text, with known secrets removed.
 *
 * Everywhere else in the migrate script a connection string is deliberately kept out of
 * the log, because Vercel build logs are durable and the URL carries the password. An
 * error thrown by the database driver is outside this project's control and may embed the
 * URL or password it was handed, so the secrets are scrubbed rather than trusted absent.
 *
 * The stack is preferred over the message so a genuine migration failure stays
 * debuggable; scrubbing applies to whichever is used.
 *
 * @param {unknown} error
 * @param {(string | undefined)[]} secrets values to remove; empty and undefined ignored
 * @returns {string}
 */
export function withoutSecrets(error, secrets) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);

  return secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .reduce((scrubbed, secret) => scrubbed.split(secret).join("[redacted]"), text);
}
