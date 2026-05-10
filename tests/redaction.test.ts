import { describe, expect, it } from "vitest";
import { redact, redactString, safeStringify } from "../src/security/redact.js";

const FAKE_KEY = "abcdef12-3456-7890-abcd-ef1234567890";

describe("redactString", () => {
  it("strips api_key= from URLs", () => {
    const url = `https://api.shoppingscraper.com/offers?api_key=${FAKE_KEY}&ean=1234`;
    const out = redactString(url);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toContain("api_key=[REDACTED]");
    expect(out).toContain("ean=1234");
  });

  it("strips apikey= and api-key= variants", () => {
    expect(redactString(`?apikey=${FAKE_KEY}`)).toContain("apikey=[REDACTED]");
    expect(redactString(`?api-key=${FAKE_KEY}`)).toContain("api-key=[REDACTED]");
  });

  it("strips api_key= even without leading ? or & (e.g. logged mid-string)", () => {
    expect(redactString(`request failed: api_key=${FAKE_KEY} dropped`)).toContain(
      "api_key=[REDACTED]",
    );
    expect(redactString(`request failed: api_key=${FAKE_KEY} dropped`)).not.toContain(FAKE_KEY);
  });

  it("strips api_key= followed by a non-UUID-shaped value (forward compat)", () => {
    const opaque = "ssckey_AbCdEf0123456789ZZZ";
    const out = redactString(`/path?api_key=${opaque}&site=amazon.de`);
    expect(out).toContain("api_key=[REDACTED]");
    expect(out).not.toContain(opaque);
    expect(out).toContain("site=amazon.de");
  });

  it("strips bare UUIDs", () => {
    expect(redactString(`leaked: ${FAKE_KEY} done`)).toBe("leaked: [REDACTED] done");
  });

  it("strips X-API-Key header values", () => {
    const line = `X-API-Key: ${FAKE_KEY}`;
    expect(redactString(line)).toContain("[REDACTED]");
    expect(redactString(line)).not.toContain(FAKE_KEY);
  });
});

describe("redact (object walker)", () => {
  it("redacts api_key field values regardless of nested location", () => {
    const obj = {
      meta: { api_key: FAKE_KEY, ok: true },
      list: [{ apiKey: FAKE_KEY }, { token: "secret" }],
      msg: `request ?api_key=${FAKE_KEY} failed`,
    };
    const out = redact(obj) as typeof obj;
    expect(out.meta.api_key).toBe("[REDACTED]");
    expect(out.list[0]!.apiKey).toBe("[REDACTED]");
    expect(out.list[1]!.token).toBe("[REDACTED]");
    expect(out.msg).not.toContain(FAKE_KEY);
  });

  it("handles cycles without crashing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe("a");
    expect(out.self).toBe("[CIRCULAR]");
  });

  it("safeStringify emits no key occurrences", () => {
    const json = safeStringify({
      url: `https://api.shoppingscraper.com/x?api_key=${FAKE_KEY}`,
      api_key: FAKE_KEY,
      nested: { request_id: `ssc_${FAKE_KEY}` },
    });
    expect(json).not.toContain(FAKE_KEY);
  });
});
