import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import type { z } from "zod";
import { resolveConfig } from "../config.js";
import type { CallResult } from "../client/endpoints.js";
import type { HttpClient } from "../client/http.js";
import type { ToolName } from "../client/schemas.js";
import { TOOL_META } from "../client/schemas.js";
import { ensureWithinCap } from "../budget/spendCap.js";
import { fail, ok, startRun } from "../output/envelope.js";
import { writeJsonLine } from "../output/json.js";
import { SscError } from "../errors.js";
import { makeClient, parseGlobalOpts, type GlobalOpts } from "./runner.js";

export interface StreamingOpts<S extends z.ZodTypeAny, O> {
  tool: ToolName;
  input: string;
  globalOpts: GlobalOpts;
  buildArgs: (line: string) => unknown;
  schema: S;
  call: (client: HttpClient, input: z.output<S>) => Promise<CallResult<O>>;
}

/**
 * Read EANs from a file (or stdin if input is "-"), fan out with the
 * configured concurrency, jitter each request 200-800ms, stream NDJSON
 * envelopes to stdout. Spend cap is enforced per-line up-front when the
 * total cost is known (it's known: line count × per-call cost).
 *
 * Concurrency default is intentionally low (5) to protect the API key's
 * reputation with target marketplaces — a 100-concurrent burst gets you
 * blacklisted by Amazon/Google before it gets you data.
 */
export async function runStreaming<S extends z.ZodTypeAny, O>(
  opts: StreamingOpts<S, O>,
): Promise<number> {
  let cfg: ReturnType<typeof resolveConfig>;
  try {
    cfg = resolveConfig(parseGlobalOpts(opts.globalOpts));
  } catch (err) {
    const ctx = startRun(opts.tool);
    writeJsonLine(fail(ctx, err));
    return (err as SscError).exitCode?.() ?? 2;
  }

  const lines = await readLines(opts.input);
  if (lines.length === 0) {
    process.stderr.write(`[ssc] no input lines found in ${opts.input}\n`);
    return 1;
  }

  try {
    ensureWithinCap(opts.tool, lines.length, cfg.maxSpendCredits);
  } catch (err) {
    const ctx = startRun(opts.tool);
    writeJsonLine(fail(ctx, err));
    return 6;
  }

  const client = makeClient(cfg);
  let exitCode = 0;
  let inFlight = 0;
  let cursor = 0;
  const concurrency = Math.max(1, cfg.concurrency);

  process.stderr.write(
    `[ssc] streaming ${lines.length} ${opts.tool} calls × ${TOOL_META[opts.tool].credits} cr = ~${
      lines.length * TOOL_META[opts.tool].credits
    } credits @ concurrency ${concurrency}\n`,
  );

  await new Promise<void>((resolve) => {
    const tick = (): void => {
      while (inFlight < concurrency && cursor < lines.length) {
        const idx = cursor++;
        const line = lines[idx]!;
        inFlight++;
        void runOne(client, opts, line)
          .then((env) => {
            writeJsonLine(env);
            if (!env.ok) exitCode = 4;
          })
          .catch((err) => {
            const ctx = startRun(opts.tool);
            writeJsonLine(fail(ctx, err));
            exitCode = 4;
          })
          .finally(() => {
            inFlight--;
            if (cursor >= lines.length && inFlight === 0) resolve();
            else tick();
          });
      }
      if (cursor >= lines.length && inFlight === 0) resolve();
    };
    tick();
  });

  await client.close();
  return exitCode;
}

async function runOne<S extends z.ZodTypeAny, O>(
  client: HttpClient,
  opts: StreamingOpts<S, O>,
  line: string,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const ctx = startRun(opts.tool);
  const parsed = opts.schema.safeParse(opts.buildArgs(line));
  if (!parsed.success) {
    return fail(
      ctx,
      new SscError(
        "USER_ERROR",
        `invalid line "${line}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      ),
    );
  }
  // jitter — protects key reputation on target marketplaces (gemini's catch).
  const jitter = 200 + Math.floor(Math.random() * 600);
  await sleep(jitter);
  try {
    const r = await opts.call(client, parsed.data);
    const meta: Record<string, unknown> = { input_line: line, jitter_ms: jitter };
    if (r.creditsRemaining !== undefined) meta.credits_remaining = r.creditsRemaining;
    if (r.creditsSpent !== undefined) meta.credits_spent = r.creditsSpent;
    return ok(ctx, r.data, meta);
  } catch (err) {
    return fail(ctx, err, { input_line: line });
  }
}

async function readLines(source: string): Promise<string[]> {
  const stream = source === "-" ? process.stdin : createReadStream(source, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const lines: string[] = [];
  for await (const raw of rl) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    lines.push(trimmed);
  }
  return lines;
}
