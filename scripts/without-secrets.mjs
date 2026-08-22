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
 * Replacement is split/join, never a regex: a secret is an opaque string that can contain
 * `.`, `?`, `$`, `(`, `)` and friends, and a regex would treat those as metacharacters.
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
