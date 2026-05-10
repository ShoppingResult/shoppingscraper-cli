import type { Command } from "commander";
import { ensureBatchCapPresent } from "../budget/spendCap.js";
import * as endpoints from "../client/endpoints.js";
import {
  BuyboxInput,
  InfoInput,
  MatchInput,
  OffersInput,
  ReviewsInput,
  type ToolName,
  VariantsInput,
} from "../client/schemas.js";
import { fail, startRun } from "../output/envelope.js";
import { writeJsonLine } from "../output/json.js";
import { type GlobalOpts, parseGlobalOpts } from "./runner.js";
import { runStreaming } from "./stream.js";

interface BatchOpts {
  input: string;
  site?: string;
  availability?: boolean;
  gl?: string;
  hl?: string;
  deepsearch?: boolean;
}

interface BatchHandler {
  tool: ToolName;
  schema: import("zod").ZodType<unknown>;
  buildArgs: (line: string, opts: BatchOpts) => unknown;
  call: (
    c: import("../client/http.js").HttpClient,
    input: unknown,
  ) => Promise<import("../client/endpoints.js").CallResult<unknown>>;
}

const BATCH_HANDLERS: Record<string, BatchHandler> = {
  offers: {
    tool: "offers",
    schema: OffersInput,
    buildArgs: (ean, opts) => ({ site: opts.site, ean, availability: opts.availability }),
    call: (c, i) => endpoints.offers(c, i as never),
  },
  info: {
    tool: "info",
    schema: InfoInput,
    buildArgs: (ean, opts) => ({ site: opts.site, ean }),
    call: (c, i) => endpoints.info(c, i as never),
  },
  buybox: {
    tool: "buybox",
    schema: BuyboxInput,
    buildArgs: (ean, opts) => ({ site: opts.site, ean, gl: opts.gl, hl: opts.hl }),
    call: (c, i) => endpoints.buybox(c, i as never),
  },
  match: {
    tool: "match",
    schema: MatchInput,
    buildArgs: (ean, opts) => ({ site: opts.site, ean, deepsearch: opts.deepsearch }),
    call: (c, i) => endpoints.match(c, i as never),
  },
  variants: {
    tool: "variants",
    schema: VariantsInput,
    buildArgs: (sku, opts) => ({ site: opts.site, sku }),
    call: (c, i) => endpoints.variants(c, i as never),
  },
  reviews: {
    tool: "reviews",
    schema: ReviewsInput,
    buildArgs: (sku, opts) => ({ site: opts.site, sku }),
    call: (c, i) => endpoints.reviews(c, i as never),
  },
};

export function registerBatch(program: Command): void {
  const batch = program
    .command("batch <subcommand>")
    .description(
      "Fan out a command across many EANs/SKUs. NDJSON output. --max-spend-credits is REQUIRED.",
    )
    .option("--input <path>", "file with one EAN/SKU per line, or - for stdin")
    .option("--site <site>", "marketplace site")
    .option("--availability", "offers only: in-stock filter", false)
    .option("--gl <country>", "buybox only: country code")
    .option("--hl <lang>", "buybox only: language code")
    .option("--deepsearch", "match only: deep search (4 credits each)", false)
    .allowExcessArguments(false);

  batch.action(async function (this: Command, subcommand: string, opts: BatchOpts) {
    const handler = BATCH_HANDLERS[subcommand];
    if (!handler) {
      const ctx = startRun(`batch.${subcommand}`);
      writeJsonLine(
        fail(
          ctx,
          new Error(
            `unknown batch subcommand: ${subcommand}. Supported: ${Object.keys(BATCH_HANDLERS).join(", ")}`,
          ),
        ),
      );
      process.exitCode = 1;
      return;
    }
    const globalOpts = this.optsWithGlobals() as GlobalOpts;
    const cfg = parseGlobalOpts(globalOpts);

    // Mandatory cap: ssc batch refuses to run without an explicit --max-spend-credits.
    try {
      ensureBatchCapPresent(cfg.maxSpendCredits ?? null);
    } catch (err) {
      const ctx = startRun(`batch.${subcommand}`);
      writeJsonLine(fail(ctx, err));
      process.exitCode = 1;
      return;
    }

    if (!opts.input) {
      process.stderr.write("ssc batch requires --input <file|->\n");
      process.exitCode = 1;
      return;
    }

    const code = await runStreaming({
      tool: handler.tool,
      input: opts.input,
      globalOpts,
      buildArgs: (line) => handler.buildArgs(line, opts),
      schema: handler.schema,
      call: handler.call,
    });
    process.exitCode = code;
  });
}
