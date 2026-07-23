import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/client/http.js";
import { ChannelAckInput, ChannelResultsInput, ChannelSubmitInput } from "../src/client/schemas.js";
import { runChannelPipeline } from "../src/commands/channel.js";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): {
  server: Server;
  seen: Seen[];
  url: () => string;
} {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return { server, seen, url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("channel auth (X-API-Key header, no query key)", () => {
  const { server, seen, url } = listen((_req, res) => json(res, {}));
  beforeAll(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", r)));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    seen.length = 0;
  });

  function client(): HttpClient {
    return new HttpClient({
      apiKey: "test-key-123",
      baseUrl: url(),
      appBaseUrl: url(),
      channelBaseUrl: url(),
      timeoutMs: 5_000,
      retries: 0,
    });
  }

  it("legacy requests carry ?api_key= and no header", async () => {
    const c = client();
    await c.request({ path: "/offers", query: { site: "amazon.de" } });
    await c.close();
    expect(seen[0]?.url).toContain("api_key=test-key-123");
    expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("channel requests carry X-API-Key and no query key", async () => {
    const c = client();
    await c.request({ path: "/v2/channel/google/status", channelBase: true });
    await c.close();
    expect(seen[0]?.headers["x-api-key"]).toBe("test-key-123");
    expect(seen[0]?.url).not.toContain("api_key");
  });
});

describe("channel input schemas", () => {
  it("accepts bare EANs and item objects, lowercases country", () => {
    const r = ChannelSubmitInput.safeParse({
      country: "NL",
      items: [
        "0190198001281",
        { ean: "5055986110651", catalog_id: "958817354363351091", title: "Walze" },
      ],
      max_pages: 3,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.country).toBe("nl");
  });

  it("rejects more than 50,000 items per submit", () => {
    const r = ChannelSubmitInput.safeParse({
      country: "nl",
      items: new Array(50_001).fill("12345678"),
    });
    expect(r.success).toBe(false);
  });

  it("caps results limit at 1000 and defaults to 1000", () => {
    expect(ChannelResultsInput.safeParse({ limit: 1001 }).success).toBe(false);
    const r = ChannelResultsInput.safeParse({});
    expect(r.success && r.data.limit).toBe(1000);
  });

  it("rejects unsafe page tokens", () => {
    expect(ChannelAckInput.safeParse({ page_token: "9f1c2ae7" }).success).toBe(true);
    expect(ChannelAckInput.safeParse({ page_token: "a b?c=1" }).success).toBe(false);
  });
});

describe("runChannelPipeline (submit → poll → drain → ack)", () => {
  let resultCalls = 0;
  const { server, seen, url } = listen((req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method === "POST" && path === "/v2/channel/google/offers") {
      return json(res, {
        accepted: 2,
        rejected: [{ ean: "12345678", reason: "invalid_ean: bad check digit" }],
      });
    }
    if (path === "/v2/channel/google/results") {
      resultCalls++;
      if (resultCalls === 1) {
        return json(res, {
          results: [
            { ean: "0190198001281", country: "nl", status: "done", response: { title: "X" } },
          ],
          page_token: "tok1",
          pending: 1,
        });
      }
      if (resultCalls === 2) {
        return json(res, {
          results: [{ ean: "5055986110651", country: "nl", status: "failed" }],
          page_token: "tok2",
          pending: 0,
        });
      }
      return json(res, { results: [], pending: 0 });
    }
    if (path === "/v2/channel/google/ack") return json(res, { acked: 1 });
    if (path === "/v2/channel/google/status") {
      return json(res, { queued: 0, claimed: 0, done: 1, failed: 1 });
    }
    res.writeHead(404);
    res.end("{}");
  });

  beforeAll(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", r)));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const lines: string[] = [];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    lines.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("streams every result, acks every page, exits 4 on partial failure", async () => {
    const code = await runChannelPipeline(
      "offers",
      { country: "nl", ean: "0190198001281" },
      { apiKey: "test-key-123", channelBaseUrl: url(), maxSpendCredits: "100" },
    );

    // 1 rejected + 1 done + 1 failed = 3 NDJSON lines
    const envelopes = lines.map((l) => JSON.parse(l));
    expect(envelopes).toHaveLength(3);
    expect(envelopes.filter((e) => e.ok)).toHaveLength(1);
    expect(envelopes.filter((e) => !e.ok)).toHaveLength(2);

    // Both pages acked, in order, after collection.
    const acks = seen.filter((s) => s.url.startsWith("/v2/channel/google/ack"));
    expect(acks.map((a) => JSON.parse(a.body).page_token)).toEqual(["tok1", "tok2"]);

    // All channel calls used header auth.
    for (const s of seen) {
      expect(s.headers["x-api-key"]).toBe("test-key-123");
      expect(s.url).not.toContain("api_key");
    }

    expect(code).toBe(4);
  });

  it("refuses to submit past the spend cap", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "ssc-channel-test-"));
    const file = join(dir, "eans.txt");
    await writeFile(file, "0190198001281\n5055986110651\n");
    try {
      const before = seen.length;
      const code = await runChannelPipeline(
        "offers",
        { country: "nl", input: file },
        { apiKey: "test-key-123", channelBaseUrl: url(), maxSpendCredits: "1" },
      );
      expect(code).toBe(6);
      expect(seen.length).toBe(before); // no HTTP call made
      const env = JSON.parse(lines.at(-1) ?? "{}");
      expect(env.error?.code).toBe("SPEND_CAP_EXCEEDED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
