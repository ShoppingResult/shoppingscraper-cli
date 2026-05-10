import { describe, expect, it } from "vitest";
import { ensureBatchCapPresent, ensureWithinCap, estimateCost } from "../src/budget/spendCap.js";
import { SscError } from "../src/errors.js";

describe("estimateCost", () => {
  it("multiplies per-tool credits by call count", () => {
    expect(estimateCost("offers", 10)).toBe(10);
    expect(estimateCost("variants", 3)).toBe(18);
    expect(estimateCost("credits", 100)).toBe(0);
  });
});

describe("ensureWithinCap", () => {
  it("passes when cap is null (unlimited)", () => {
    expect(() => ensureWithinCap("offers", 1000, null)).not.toThrow();
  });

  it("passes when cost <= cap", () => {
    expect(() => ensureWithinCap("offers", 50, 100)).not.toThrow();
    expect(() => ensureWithinCap("variants", 10, 60)).not.toThrow();
  });

  it("throws SPEND_CAP_EXCEEDED when cost > cap", () => {
    let thrown: SscError | null = null;
    try {
      ensureWithinCap("variants", 20, 50);
    } catch (e) {
      thrown = e as SscError;
    }
    expect(thrown).toBeInstanceOf(SscError);
    expect(thrown?.code).toBe("SPEND_CAP_EXCEEDED");
    expect(thrown?.exitCode()).toBe(6);
    expect(thrown?.details?.estimated_cost).toBe(120);
  });
});

describe("ensureBatchCapPresent", () => {
  it("throws when cap is null", () => {
    expect(() => ensureBatchCapPresent(null)).toThrowError(/--max-spend-credits/);
  });
  it("passes when cap is set", () => {
    expect(() => ensureBatchCapPresent(50)).not.toThrow();
    expect(() => ensureBatchCapPresent(0)).not.toThrow();
  });
});
