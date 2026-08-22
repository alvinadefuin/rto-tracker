import { describe, expect, it } from "vitest";
import { secretsInUrl, withoutSecrets } from "./without-secrets.mjs";

const URL_WITH_PASSWORD = "postgresql://user:hunter2@ep-example.aws.neon.tech/neondb";

describe("withoutSecrets", () => {
  it("removes a whole connection string from an error message", () => {
    const error = new Error(`connect failed for ${URL_WITH_PASSWORD}`);
    const text = withoutSecrets(error, [URL_WITH_PASSWORD, "hunter2"]);
    expect(text).not.toContain(URL_WITH_PASSWORD);
    expect(text).not.toContain("hunter2");
    expect(text).toContain("[redacted]");
  });

  it("removes a bare password even when the full URL is absent", () => {
    const error = new Error("password authentication failed for hunter2");
    expect(withoutSecrets(error, [URL_WITH_PASSWORD, "hunter2"])).not.toContain("hunter2");
  });

  it("replaces every occurrence, not just the first", () => {
    const error = new Error("hunter2 then hunter2 again");
    expect(withoutSecrets(error, ["hunter2"])).toContain("[redacted] then [redacted] again");
  });

  it("treats a secret with regex metacharacters literally", () => {
    // Pins the split/join implementation. `new RegExp("a.c")` matches "abc" as well, so a
    // regex-based scrubber would redact the near-miss; split/join must redact only the
    // literal secret and leave the near-miss untouched.
    expect(withoutSecrets(new Error("saw a.c"), ["a.c"])).toContain("saw [redacted]");
    expect(withoutSecrets(new Error("saw abc"), ["a.c"])).toContain("saw abc");

    // And a password full of metacharacters is still removed in full.
    const messy = "p$ss(w)rd[1]?";
    expect(withoutSecrets(new Error(`auth failed for ${messy}`), [messy])).not.toContain(messy);
  });

  it("keeps the stack when there is one, so a failure stays debuggable", () => {
    const error = new Error("boom");
    expect(withoutSecrets(error, [])).toContain("boom");
    expect(withoutSecrets(error, [])).toContain("without-secrets.test.mjs");
  });

  it("falls back to the message when there is no stack", () => {
    const error = new Error("boom");
    error.stack = undefined;
    expect(withoutSecrets(error, [])).toBe("boom");
  });

  it("ignores undefined and empty secrets instead of redacting everything", () => {
    const error = new Error("boom");
    expect(withoutSecrets(error, [undefined, ""])).toContain("boom");
    expect(withoutSecrets(error, [undefined, ""])).not.toContain("[redacted]");
  });

  it("follows the cause chain, because .stack omits it", () => {
    // Drizzle wraps driver failures: the message is the failing SQL, and the actual
    // Postgres error with its SQLSTATE hangs off .cause. Without this, the one log line
    // that matters says what failed and not why.
    const postgres = new Error('relation "user" already exists');
    const wrapped = new Error('Failed query: CREATE TABLE "user" (...)', { cause: postgres });
    const text = withoutSecrets(wrapped, []);
    expect(text).toContain("Failed query");
    expect(text).toContain('relation "user" already exists');
  });

  it("scrubs a secret that appears only in the cause", () => {
    const inner = new Error("auth failed for hunter2");
    const outer = new Error("Failed query: select 1", { cause: inner });
    expect(withoutSecrets(outer, ["hunter2"])).not.toContain("hunter2");
  });

  it("does not hang on a circular cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    const text = withoutSecrets(a, []);
    expect(text).toContain("a");
    expect(text).toContain("b");
  });

  it("still renders an error with no cause exactly as before", () => {
    const error = new Error("boom");
    expect(withoutSecrets(error, [])).toBe(error.stack);
  });

  it("handles a thrown value that is not an Error", () => {
    expect(withoutSecrets("plain hunter2 string", ["hunter2"])).toBe("plain [redacted] string");
    expect(withoutSecrets(42, [])).toBe("42");
  });
});

describe("secretsInUrl", () => {
  it("yields the whole URL and the password", () => {
    const secrets = secretsInUrl(URL_WITH_PASSWORD);
    expect(secrets).toContain(URL_WITH_PASSWORD);
    expect(secrets).toContain("hunter2");
  });

  it("yields the decoded password too, since a driver decodes before use", () => {
    // new URL(...).password is the *encoded* form, so scrubbing it alone would miss the
    // decoded form that a driver error would actually carry.
    const secrets = secretsInUrl("postgresql://user:p%40ss%21word@ep-example.aws.neon.tech/db");
    expect(secrets).toContain("p%40ss%21word");
    expect(secrets).toContain("p@ss!word");
  });

  it("returns the raw string for an unparseable URL rather than throwing", () => {
    // The caller needs this to report the parse failure without leaking.
    expect(secretsInUrl("not a url at all")).toEqual(["not a url at all"]);
  });

  it("does not throw on a password that cannot be percent-decoded", () => {
    const secrets = secretsInUrl("postgresql://user:100%@ep-example.aws.neon.tech/db");
    expect(secrets).toContain("100%");
  });

  it("yields nothing that would redact unrelated text when there is no password", () => {
    const secrets = secretsInUrl("postgresql://ep-example.aws.neon.tech/db");
    expect(withoutSecrets(new Error("an ordinary message"), secrets)).toContain(
      "an ordinary message"
    );
  });
});
