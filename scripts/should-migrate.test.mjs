import { describe, expect, it } from "vitest";
import { shouldMigrate } from "./should-migrate.mjs";

describe("shouldMigrate", () => {
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

  it("treats an empty VERCEL_ENV as a skip, not as absent", () => {
    expect(shouldMigrate({ VERCEL_ENV: "" }).run).toBe(false);
  });

  it("is case-sensitive, so 'Production' does not pass", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "Production" }).run).toBe(false);
  });

  it("names the offending value in the reason, so a build log explains itself", () => {
    expect(shouldMigrate({ VERCEL: "1", VERCEL_ENV: "preview" }).reason).toContain("preview");
  });

  it("reports a readable reason when VERCEL_ENV is unset on Vercel", () => {
    expect(shouldMigrate({ VERCEL: "1" }).reason).toContain("unset");
  });
});
