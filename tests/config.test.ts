import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import type { SscError } from "../src/errors.js";

describe("resolveConfig", () => {
  const orig = process.env.SSC_API_KEY;
  beforeEach(() => {
    // `delete` is intentional — assigning `undefined` would coerce to the
    // string "undefined" and pass my falsy check, breaking the AUTH_MISSING
    // test below.
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.SSC_API_KEY;
  });
  afterEach(() => {
    if (orig) process.env.SSC_API_KEY = orig;
  });

  it("flag wins over env", () => {
    process.env.SSC_API_KEY = "env-key";
    const cfg = resolveConfig({ apiKey: "flag-key" });
    expect(cfg.apiKey).toBe("flag-key");
    expect(cfg.source).toBe("flag");
  });

  it("env wins over (missing) file", () => {
    process.env.SSC_API_KEY = "env-key";
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe("env-key");
    expect(cfg.source).toBe("env");
  });

  it("throws AUTH_MISSING when no key anywhere", () => {
    let thrown: SscError | null = null;
    try {
      resolveConfig();
    } catch (e) {
      thrown = e as SscError;
    }
    expect(thrown?.code).toBe("AUTH_MISSING");
    expect(thrown?.exitCode()).toBe(2);
  });

  it("default max-spend-credits is 100", () => {
    process.env.SSC_API_KEY = "x";
    const cfg = resolveConfig();
    expect(cfg.maxSpendCredits).toBe(100);
  });

  it("explicit null disables spend cap", () => {
    process.env.SSC_API_KEY = "x";
    const cfg = resolveConfig({ maxSpendCredits: null });
    expect(cfg.maxSpendCredits).toBeNull();
  });
});
