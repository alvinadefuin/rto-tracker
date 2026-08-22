/**
 * Render an unknown thrown value as text, with known secrets removed.
 *
 * Everywhere else in the migrate script a connection string is deliberately kept out of
 * the log, because Vercel build logs are durable and the URL carries the password. An
 * error thrown by the database driver — or by `new URL` — is outside this project's
 * control and may embed the URL or password it was handed, so the secrets are scrubbed
 * rather than trusted absent.
 *
 * The stack is preferred over the message so a genuine failure stays debuggable, and
 * scrubbing applies to whichever is used. Note that reading `.stack` also *drops* own
 * properties such as ERR_INVALID_URL's `input`, which is where the raw connection string
 * would otherwise sit.
 *
 * The `cause` chain is followed, because `.stack` omits it and drizzle needs it. Drizzle
 * wraps every driver failure in a DrizzleQueryError whose message is the failing SQL and
 * whose `cause` holds the actual Postgres error and its SQLSTATE. Without the chain, the
 * most consequential line this system ever logs says *what* failed and not *why* — while
 * the reader is looking at a partially-applied schema.
 *
 * Replacement is split/join, never a regex: a secret is an opaque string that can contain
 * `.`, `?`, `$`, `(`, `)` and friends, and a regex would treat those as metacharacters.
 * It is applied to the whole assembled text, so a secret surfacing only in a cause is
 * scrubbed too.
 *
 * @param {unknown} error
 * @param {(string | undefined)[]} secrets values to remove; empty and undefined ignored
 * @returns {string}
 */
export function withoutSecrets(error, secrets) {
  return secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .reduce((scrubbed, secret) => scrubbed.split(secret).join("[redacted]"), describe(error));
}

/** Depth cap: a `cause` chain can be circular, and no real one is this deep. */
const MAX_CAUSE_DEPTH = 4;

/**
 * An error rendered as text, following `cause` because `.stack` does not.
 *
 * @param {unknown} value
 * @param {number} depth
 * @returns {string}
 */
function describe(value, depth = 0) {
  if (!(value instanceof Error)) return String(value);

  const rendered = value.stack ?? value.message;
  if (value.cause === undefined || depth >= MAX_CAUSE_DEPTH) return rendered;

  return `${rendered}\n  caused by: ${describe(value.cause, depth + 1)}`;
}

/**
 * Every form of a credential that could appear in an error message, for one connection
 * string: the whole string, the password as the URL encodes it, and the password decoded.
 * Drivers decode before use, so the decoded form is the one an error is likeliest to
 * carry, and `new URL(...).password` alone would miss it.
 *
 * Never throws. An unparseable string still yields itself, which is exactly what the
 * caller needs in order to report a parse failure safely.
 *
 * @param {string} url
 * @returns {(string | undefined)[]} for withoutSecrets, which ignores empty entries
 */
export function secretsInUrl(url) {
  const secrets = [url];

  let password;
  try {
    password = new URL(url).password;
  } catch {
    return secrets;
  }
  secrets.push(password);

  try {
    secrets.push(decodeURIComponent(password));
  } catch {
    // A lone "%" is not decodable. The encoded form above is still scrubbed.
  }

  return secrets;
}
