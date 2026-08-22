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
