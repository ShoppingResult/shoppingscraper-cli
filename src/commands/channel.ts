import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import type { Command } from "commander";
import { ensureWithinCap } from "../budget/spendCap.js";
import * as endpoints from "../client/endpoints.js";
import type { ChannelKind } from "../client/endpoints.js";
import {
  ChannelAckInput,
  type ChannelItemT,
  ChannelResultsInput,
  ChannelStatusInput,
  ChannelSubmitInput,
  type ToolName,
} from "../client/schemas.js";
import { resolveConfig } from "../config.js";
import { SscError } from "../errors.js";
import { fail, ok, startRun } from "../output/envelope.js";
import { writeJsonLine } from "../output/json.js";
import { type GlobalOpts, makeClient, parseGlobalOpts, runCommand } from "./runner.js";

/**
 * Channel API command surface, shared by `ssc offers` and `ssc match`.
 *
 * Two ways in:
 *  - Blocking pipeline (`ssc offers --country nl --input eans.txt`): submit,
 *    poll status, drain results in pages, ack each page, stream NDJSON lines,
 *    exit when everything accepted has been collected.
 *  - Raw steps (`ssc offers submit|status|results|ack`): one envelope per
 *    invocation, for scripts that drive the loop across separate runs (large
 *    batches, cron collection within the ~6h drain TTL).
 */

const MAX_ITEMS_PER_SUBMIT = 50_000;
const POLL_START_MS = 2_000;
const POLL_MAX_MS = 15_000;

function submitTool(kind: ChannelKind): ToolName {
  return kind === "offers" ? "offers_submit" : "match_submit";
}

interface ChannelCommonOpts {
  country?: string;
  ean?: string;
  input?: string;
  maxPages?: string;
  applicationId?: string;
}

/** Parse --input lines: bare EANs or NDJSON objects {ean, catalog_id?, title?}. */
async function readItems(source: string): Promise<ChannelItemT[]> {
  const stream = source === "-" ? process.stdin : createReadStream(source, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const items: ChannelItemT[] = [];
  for await (const raw of rl) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("{")) {
      try {
        items.push(JSON.parse(trimmed) as ChannelItemT);
      } catch {
        throw new SscError("USER_ERROR", `invalid JSON input line: ${trimmed.slice(0, 80)}`);
      }
    } else {
      items.push(trimmed);
    }
  }
  return items;
}

async function collectItems(opts: ChannelCommonOpts): Promise<ChannelItemT[]> {
  if (opts.input) return readItems(opts.input);
  if (opts.ean) return [opts.ean];
  throw new SscError("USER_ERROR", "provide --ean <ean> or --input <file|-> with EANs.");
}

function buildSubmitBody(opts: ChannelCommonOpts, items: ChannelItemT[]): Record<string, unknown> {
  return {
    country: opts.country,
    items,
    ...(opts.maxPages !== undefined ? { max_pages: Number(opts.maxPages) } : {}),
    ...(opts.applicationId !== undefined ? { application_id: opts.applicationId } : {}),
  };
}

export function registerChannelSubcommands(parent: Command, kind: ChannelKind): void {
  const label = kind === "offers" ? "Google Shopping offers" : "Google catalog matches";

  parent
    .command("submit")
    .description(
      `Channel API: submit up to ${MAX_ITEMS_PER_SUBMIT} EANs for ${label} (1 credit per EAN, async)`,
    )
    .requiredOption("--country <cc>", "two-letter market code (nl, de, us, ...)")
    .option("--ean <ean>", "single EAN/GTIN")
    .option("--input <path>", "file with EANs (one per line, or NDJSON objects), - for stdin")
    .option("--max-pages <n>", "pagination depth per product (1-50)")
    .option("--application-id <id>", "scope submission to an application")
    .action(async function (this: Command, opts: ChannelCommonOpts) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;
      const ctx = startRun(`${kind}.submit`);
      let items: ChannelItemT[];
      let cap: number | null;
      try {
        items = await collectItems(opts);
        cap = resolveConfig(parseGlobalOpts(globalOpts)).maxSpendCredits;
        if (items.length > MAX_ITEMS_PER_SUBMIT) {
          throw new SscError(
            "USER_ERROR",
            `${items.length} items exceeds the ${MAX_ITEMS_PER_SUBMIT} per-submit limit. Split the input, or use the blocking form (ssc ${kind === "offers" ? "offers" : "match"} --country ... --input ...) which chunks automatically.`,
          );
        }
        // Submit is the billable step: 1 credit per EAN.
        ensureWithinCap(submitTool(kind), items.length, cap);
      } catch (err) {
        writeJsonLine(fail(ctx, err));
        process.exitCode = err instanceof SscError && err.code === "SPEND_CAP_EXCEEDED" ? 6 : 1;
        return;
      }
      const code = await runCommand({
        command: `${kind}.submit`,
        schema: ChannelSubmitInput,
        rawInput: buildSubmitBody(opts, items),
        call: (c, i) => endpoints.channelSubmit(c, kind, i),
        globalOpts,
      });
      process.exitCode = code;
    });

  parent
    .command("status")
    .description("Channel API: queued/claimed/done/failed counts for submitted jobs")
    .option("--application-id <id>", "restrict to an application scope")
    .action(async function (this: Command, opts: { applicationId?: string }) {
      const code = await runCommand({
        command: `${kind}.status`,
        tool: kind === "offers" ? "offers_status" : "match_status",
        schema: ChannelStatusInput,
        rawInput: { application_id: opts.applicationId },
        call: (c, i) => endpoints.channelStatus(c, kind, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });

  parent
    .command("results")
    .description("Channel API: collect one page of finished results (max 1000)")
    .option("--limit <n>", "page size (1-1000)", "1000")
    .option("--application-id <id>", "restrict to an application scope")
    .option("--ack", "acknowledge the page after printing it (releases it upstream)", false)
    .action(async function (
      this: Command,
      opts: { limit?: string; applicationId?: string; ack?: boolean },
    ) {
      const code = await runCommand({
        command: `${kind}.results`,
        tool: kind === "offers" ? "offers_results" : "match_results",
        schema: ChannelResultsInput,
        rawInput: {
          limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
          application_id: opts.applicationId,
        },
        call: async (c, i) => {
          const r = await endpoints.channelResults(c, kind, i);
          if (opts.ack && r.data.page_token && r.data.results.length > 0) {
            await endpoints.channelAck(c, kind, { page_token: r.data.page_token });
            process.stderr.write(`[ssc] acked page ${r.data.page_token.slice(0, 12)}...\n`);
          }
          return r;
        },
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });

  parent
    .command("ack")
    .description("Channel API: acknowledge a results page by page_token")
    .requiredOption("--page-token <token>", "cursor from the results response")
    .action(async function (this: Command, opts: { pageToken: string }) {
      const code = await runCommand({
        command: `${kind}.ack`,
        tool: kind === "offers" ? "offers_ack" : "match_ack",
        schema: ChannelAckInput,
        rawInput: { page_token: opts.pageToken },
        call: (c, i) => endpoints.channelAck(c, kind, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}

export interface ChannelPipelineOpts extends ChannelCommonOpts {
  waitTimeout?: string;
}

/**
 * Blocking pipeline: submit → poll → drain → ack, streaming one NDJSON
 * envelope per product result. Returns the process exit code.
 *
 * Delivery is at-least-once: pages are acked only after their lines are
 * written, so an interrupted run redelivers rather than loses results.
 */
export async function runChannelPipeline(
  kind: ChannelKind,
  opts: ChannelPipelineOpts,
  globalOpts: GlobalOpts,
): Promise<number> {
  const ctx = startRun(`${kind}.run`);
  let cfg: ReturnType<typeof resolveConfig>;
  let items: ChannelItemT[];
  try {
    cfg = resolveConfig(parseGlobalOpts(globalOpts));
    items = await collectItems(opts);
    ensureWithinCap(submitTool(kind), items.length, cfg.maxSpendCredits);
  } catch (err) {
    writeJsonLine(fail(ctx, err));
    return err instanceof SscError && err.code === "SPEND_CAP_EXCEEDED" ? 6 : 1;
  }

  const timeoutMs = Math.max(1, Number(opts.waitTimeout ?? "3600")) * 1000;
  const deadline = Date.now() + timeoutMs;
  const client = makeClient(cfg);
  let accepted = 0;
  let rejected = 0;
  let collected = 0;
  let failedEntries = 0;

  try {
    // Submit in chunks. Non-idempotent: a timed-out POST may have landed, so
    // we never blindly re-post a chunk — the HttpClient only retries on
    // 429/5xx SscErrors marked retryable, and reconciliation is against the
    // `accepted` counts we got back.
    for (let i = 0; i < items.length; i += MAX_ITEMS_PER_SUBMIT) {
      const chunk = items.slice(i, i + MAX_ITEMS_PER_SUBMIT);
      const parsed = ChannelSubmitInput.safeParse(buildSubmitBody(opts, chunk));
      if (!parsed.success) {
        const err = new SscError(
          "USER_ERROR",
          `invalid arguments: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`,
        );
        writeJsonLine(fail(ctx, err));
        return 1;
      }
      const res = await endpoints.channelSubmit(client, kind, parsed.data);
      accepted += res.data.accepted;
      for (const rej of res.data.rejected ?? []) {
        rejected++;
        writeJsonLine(
          fail(startRun(`${kind}.run`), new SscError("USER_ERROR", `rejected: ${rej.reason}`), {
            ean: rej.ean,
          }),
        );
      }
      process.stderr.write(
        `[ssc] submitted ${Math.min(i + chunk.length, items.length)}/${items.length} (accepted ${accepted}, rejected ${rejected})\n`,
      );
    }

    if (accepted === 0) {
      process.stderr.write("[ssc] nothing accepted; nothing to collect.\n");
      return rejected > 0 ? 4 : 0;
    }

    // Drain loop. Ack only after a page's lines are on stdout.
    let idleMs = POLL_START_MS;
    while (Date.now() < deadline) {
      const page = await endpoints.channelResults(client, kind, {
        limit: 1000,
        ...(opts.applicationId !== undefined ? { application_id: opts.applicationId } : {}),
      });
      if (page.data.results.length > 0) {
        for (const entry of page.data.results) {
          const lineCtx = startRun(`${kind}.run`);
          if (entry.status === "failed") {
            failedEntries++;
            writeJsonLine(
              fail(lineCtx, new SscError("UPSTREAM_ERROR", "product lookup failed"), {
                ean: entry.ean,
                country: entry.country,
              }),
            );
          } else {
            writeJsonLine(ok(lineCtx, entry));
          }
        }
        collected += page.data.results.length;
        if (page.data.page_token) {
          await endpoints.channelAck(client, kind, { page_token: page.data.page_token });
        }
        process.stderr.write(`[ssc] collected ${collected}/${accepted}\n`);
        idleMs = POLL_START_MS;
        continue;
      }

      // Empty page: check whether anything is still coming. Status counts are
      // key-wide (or application-wide when scoped), so `collected >= accepted`
      // is our primary stop signal and quiescence the secondary one.
      const status = await endpoints.channelStatus(client, kind, {
        ...(opts.applicationId !== undefined ? { application_id: opts.applicationId } : {}),
      });
      const inFlight = status.data.queued + status.data.claimed;
      if (collected >= accepted) break;
      if (inFlight === 0 && !page.data.pending) {
        process.stderr.write(
          `[ssc] warning: queue quiet but only ${collected}/${accepted} collected (results may have been drained elsewhere or pruned past the ~6h TTL).\n`,
        );
        break;
      }
      await sleep(idleMs);
      idleMs = Math.min(Math.floor(idleMs * 1.5), POLL_MAX_MS);
    }

    if (Date.now() >= deadline && collected < accepted) {
      process.stderr.write(
        `[ssc] wait timeout after ${Math.round(timeoutMs / 1000)}s with ${collected}/${accepted} collected. Results stay available ~6h: resume with \`ssc ${kind === "offers" ? "offers" : "match"} results --ack\`.\n`,
      );
      return 5;
    }

    process.stderr.write(
      `[ssc] done: accepted ${accepted}, rejected ${rejected}, collected ${collected}, failed ${failedEntries}\n`,
    );
    return rejected > 0 || failedEntries > 0 ? 4 : 0;
  } catch (err) {
    writeJsonLine(fail(ctx, err));
    return 4;
  } finally {
    await client.close();
  }
}
