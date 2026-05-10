import { describe, expect, it } from "vitest";
import { OffersInput, PageInput, VariantsInput } from "../src/client/schemas.js";

describe("SiteSchema (via OffersInput)", () => {
  it("accepts valid marketplace hostnames", () => {
    for (const site of [
      "amazon.de",
      "amazon.co.uk",
      "shopping.google.nl",
      "bol.com",
      "coolblue.be",
      "global",
    ]) {
      const r = OffersInput.safeParse({ site, ean: "0190198001281" });
      expect(r.success, `expected ${site} to pass`).toBe(true);
    }
  });

  it("rejects path/query injection attempts", () => {
    for (const site of [
      "../admin",
      "amazon.de/path",
      "amazon.de?evil=1",
      "amazon.de#frag",
      "amazon de",
      "amazon..de",
      "",
    ]) {
      const r = OffersInput.safeParse({ site, ean: "0190198001281" });
      expect(r.success, `expected ${JSON.stringify(site)} to fail`).toBe(false);
    }
  });
});

describe("UrlSchema (via PageInput)", () => {
  it("accepts public http(s) URLs", () => {
    for (const url of [
      "https://www.amazon.de/dp/B0XXXXXXXX",
      "http://example.com/path?q=1",
      "https://shopping.google.nl/product/123",
    ]) {
      const r = PageInput.safeParse({ url });
      expect(r.success, `expected ${url} to pass`).toBe(true);
    }
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>x()</script>",
      "file:///etc/passwd",
      "ftp://example.com/x",
    ]) {
      const r = PageInput.safeParse({ url });
      expect(r.success, `expected ${url} to fail`).toBe(false);
    }
  });

  it("rejects localhost / loopback / private / link-local hosts (SSRF defense-in-depth)", () => {
    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://172.31.0.1/",
      "http://169.254.169.254/", // AWS/GCP/Azure metadata
      "http://metadata.google.internal/",
      "http://[::1]/",
      "http://[::]/",
      // IPv4-mapped IPv6 — must be rejected (CodeRabbit-flagged SSRF bypass)
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:192.168.1.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:172.16.0.1]/",
    ]) {
      const r = PageInput.safeParse({ url });
      expect(r.success, `expected ${url} to fail`).toBe(false);
    }
  });
});

describe("SkuSchema (via VariantsInput)", () => {
  it("accepts safe SKU shapes", () => {
    for (const sku of ["12345678901234567", "ABC-123_xyz.4", "B0XXXXXXXX"]) {
      const r = VariantsInput.safeParse({ site: "shopping.google.nl", sku });
      expect(r.success).toBe(true);
    }
  });

  it("rejects shell/url-injection attempts", () => {
    for (const sku of ["123;rm -rf /", "abc def", "../../../etc/passwd", "foo&bar=1", ""]) {
      const r = VariantsInput.safeParse({ site: "shopping.google.nl", sku });
      expect(r.success, `expected ${JSON.stringify(sku)} to fail`).toBe(false);
    }
  });
});
