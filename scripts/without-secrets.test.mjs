import { describe, expect, it } from "vitest";
import { withoutSecrets } from "./without-secrets.mjs";

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
    expect(withoutSecrets(error, ["hunter2"])).toBe(
      withoutSecrets(error, ["hunter2"]).replace(/hunter2/g, "[redacted]")
    );
    expect(withoutSecrets(error, ["hunter2"])).not.toContain("hunter2");
  });

  it("keeps the stack when there is one, so a failure stays debuggable", () => {
    const error = new Error("boom");
    expect(withoutSecrets(error, [])).toContain("boom");
    expect(withoutSecrets(error, [])).toContain("without-secrets.test.mjs");
  });

  it("ignores undefined and empty secrets instead of redacting everything", () => {
    const error = new Error("boom");
    expect(withoutSecrets(error, [undefined, ""])).toContain("boom");
    expect(withoutSecrets(error, [undefined, ""])).not.toContain("[redacted]");
  });

  it("handles a thrown value that is not an Error", () => {
    expect(withoutSecrets("plain hunter2 string", ["hunter2"])).toBe("plain [redacted] string");
    expect(withoutSecrets(42, [])).toBe("42");
  });
});
