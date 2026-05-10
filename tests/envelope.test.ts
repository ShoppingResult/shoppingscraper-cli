import { describe, expect, it } from "vitest";
import { fail, ok, startRun } from "../src/output/envelope.js";
import { SscError } from "../src/errors.js";
import { ENVELOPE_VERSION } from "../src/version.js";

const FAKE_KEY = "abcdef12-3456-7890-abcd-ef1234567890";

describe("envelope", () => {
  it("ok() emits the canonical shape with redacted result", () => {
    const ctx = startRun("offers");
    const env = ok(ctx, { url: `?api_key=${FAKE_KEY}`, items: [1, 2] });
    expect(env._v).toBe(ENVELOPE_VERSION);
    expect(env.ok).toBe(true);
    expect(env.command).toBe("offers");
    expect(env.error).toBe(null);
    expect(env.meta.request_id).toMatch(/^ssc_[0-9a-f]{16}$/);
    expect(env.meta.duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(env)).not.toContain(FAKE_KEY);
  });

  it("fail() carries SscError code and http_status", () => {
    const ctx = startRun("offers");
    const env = fail(
      ctx,
      new SscError("RATE_LIMITED", `429 from api?api_key=${FAKE_KEY}`, {
        httpStatus: 429,
        retryable: true,
      }),
    );
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("RATE_LIMITED");
    expect(env.error?.http_status).toBe(429);
    expect(env.error?.retryable).toBe(true);
    expect(JSON.stringify(env)).not.toContain(FAKE_KEY);
  });

  it("fail() wraps unknown errors as UPSTREAM_ERROR", () => {
    const ctx = startRun("offers");
    const env = fail(ctx, new Error("kaboom"));
    expect(env.error?.code).toBe("UPSTREAM_ERROR");
    expect(env.error?.message).toBe("kaboom");
  });
});
