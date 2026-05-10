import type { z } from "zod";
import { HttpClient } from "../client/http.js";
import type { CallResult } from "../client/endpoints.js";
import type { ToolName } from "../client/schemas.js";
import { ensureWithinCap } from "../budget/spendCap.js";
import { resolveConfig, type ConfigInputs } from "../config.js";
import { fail, ok, startRun } from "../output/envelope.js";
import { writeJson } from "../output/json.js";
import { writePretty } from "../output/pretty.js";
import { SscError } from "../errors.js";
import { redactString } from "../security/redact.js";

export interface GlobalOpts {
  apiKey?: string;
  pretty?: boolean;
  quiet?: boolean;
  timeout?: string;
  retries?: string;
  concurrency?: string;
  maxSpendCredits?: string;
  baseUrl?: string;
  appBaseUrl?: string;
}

export function parseGlobalOpts(opts: GlobalOpts): ConfigInputs {
  const cfg: ConfigInputs = {};
  if (opts.apiKey !== undefined) cfg.apiKey = opts.apiKey;
  if (opts.pretty !== undefined) cfg.pretty = opts.pretty;
  if (opts.quiet !== undefined) cfg.quiet = opts.quiet;
  if (opts.baseUrl !== undefined) cfg.baseUrl = opts.baseUrl;
  if (opts.appBaseUrl !== undefined) cfg.appBaseUrl = opts.appBaseUrl;
  if (opts.timeout !== undefined) {
    const n = Number(opts.timeout);
    if (Number.isFinite(n) && n > 0) cfg.timeoutMs = n * 1000;
  }
  if (opts.retries !== undefined) {
    const n = Number(opts.retries);
    if (Number.isInteger(n) && n >= 0) cfg.retries = n;
  }
  if (opts.concurrency !== undefined) {
    const n = Number(opts.concurrency);
    if (Number.isInteger(n) && n > 0) cfg.concurrency = n;
  }
  if (opts.maxSpendCredits !== undefined) {
    if (opts.maxSpendCredits.toLowerCase() === "none" || opts.maxSpendCredits === "0") {
      cfg.maxSpendCredits = null;
    } else {
      const n = Number(opts.maxSpendCredits);
      if (Number.isFinite(n) && n >= 0) cfg.maxSpendCredits = n;
    }
  }
  return cfg;
}

export interface RunOptions<S extends z.ZodTypeAny, O> {
  command: ToolName | string;
  tool?: ToolName;
  schema: S;
  rawInput: unknown;
  call: (client: HttpClient, input: z.output<S>) => Promise<CallResult<O>>;
  globalOpts: GlobalOpts;
  /** For batch helper — already-resolved config + client. */
  preResolved?: { client: HttpClient; cfg: ReturnType<typeof resolveConfig> };
}

/**
 * Universal command runner. Validates input, enforces spend cap, calls the
 * endpoint, wraps output in the envelope, writes to stdout, and returns the
 * exit code. Every CLI command boils down to one call to this function.
 */
export async function runCommand<S extends z.ZodTypeAny, O>(
  opts: RunOptions<S, O>,
): Promise<number> {
  const ctx = startRun(opts.command);

  let cfg: ReturnType<typeof resolveConfig>;
  try {
    cfg = opts.preResolved?.cfg ?? resolveConfig(parseGlobalOpts(opts.globalOpts));
  } catch (err) {
    return finish(ctx, fail(ctx, err), false, false);
  }

  const parsed = opts.schema.safeParse(opts.rawInput);
  if (!parsed.success) {
    const err = new SscError(
      "USER_ERROR",
      `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      { details: { issues: parsed.error.issues } },
    );
    return finish(ctx, fail(ctx, err), cfg.pretty, cfg.quiet);
  }

  if (opts.tool) {
    try {
      ensureWithinCap(opts.tool, 1, cfg.maxSpendCredits);
    } catch (err) {
      return finish(ctx, fail(ctx, err), cfg.pretty, cfg.quiet);
    }
  }

  const client = opts.preResolved?.client ?? makeClient(cfg);
  try {
    const result = await opts.call(client, parsed.data);
    const meta: Record<string, unknown> = {};
    if (result.creditsRemaining !== undefined) meta.credits_remaining = result.creditsRemaining;
    if (result.creditsSpent !== undefined) meta.credits_spent = result.creditsSpent;
    return finish(ctx, ok(ctx, result.data, meta), cfg.pretty, cfg.quiet);
  } catch (err) {
    return finish(ctx, fail(ctx, err), cfg.pretty, cfg.quiet);
  } finally {
    if (!opts.preResolved) await client.close();
  }
}

export function makeClient(cfg: ReturnType<typeof resolveConfig>): HttpClient {
  return new HttpClient({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    appBaseUrl: cfg.appBaseUrl,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
  });
}

function finish(
  _ctx: ReturnType<typeof startRun>,
  envelope: ReturnType<typeof ok> | ReturnType<typeof fail>,
  pretty: boolean,
  quiet: boolean,
): number {
  if (!quiet) {
    if (pretty) writePretty(envelope);
    else writeJson(envelope, false);
  }
  if (envelope.ok) return 0;
  // Map error code to exit code via SscError mapping. Envelope error.code is
  // already the SscError code string.
  const code = envelope.error?.code;
  if (!code) return 1;
  // Avoid importing EXIT_CODES at module top to dodge circular imports.
  switch (code) {
    case "AUTH_MISSING":
    case "AUTH_INVALID":
      return 2;
    case "RATE_LIMITED":
      return 3;
    case "SPEND_CAP_EXCEEDED":
      return 6;
    case "NETWORK_ERROR":
      return 5;
    case "USER_ERROR":
      return 1;
    default:
      return 4;
  }
}

/** Defensive: ensure no env-var leak in process listings on shared boxes. */
export function scrubArgvForLogging(argv: readonly string[]): string[] {
  return argv.map((a) => redactString(a));
}
