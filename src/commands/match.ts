import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { MatchInput } from "../client/schemas.js";
import {
  type ChannelPipelineOpts,
  registerChannelSubcommands,
  runChannelPipeline,
} from "./channel.js";
import { type GlobalOpts, runCommand } from "./runner.js";
import { runStreaming } from "./stream.js";

interface MatchOpts extends ChannelPipelineOpts {
  site?: string;
  deepsearch?: boolean;
}

export function registerMatch(program: Command): void {
  const match = program
    .command("match")
    .description(
      "Match EANs to catalog entries. Google: channel API via --country (returns catalog_id + title, async batch, or the submit/status/results/ack subcommands). Amazon/Bol.com: legacy sync via --site.",
    )
    .option("--country <cc>", "Google catalog matching (channel API): nl, de, us, ...")
    .option("--site <site>", "legacy sync site: amazon.<tld> or bol.com")
    .option("--ean <ean>", "EAN/GTIN (8-14 digits)")
    .option(
      "--input <path>",
      "file with EANs (one per line; channel also accepts NDJSON objects), - for stdin",
    )
    .option(
      "--deepsearch",
      "legacy only: thorough match (4 credits, advisory: requires confirmation)",
      false,
    )
    .option("--max-pages <n>", "channel only: pagination depth per product (1-50)")
    .option("--application-id <id>", "channel only: application scope")
    .option("--wait-timeout <seconds>", "channel only: max wait for collection (default 3600)")
    .action(async function (this: Command, opts: MatchOpts) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;

      if (opts.country) {
        process.exitCode = await runChannelPipeline("match", opts, globalOpts);
        return;
      }

      if (!opts.site) {
        process.stderr.write(
          "Provide --country <cc> (Google catalog matching, channel API) or --site amazon.<tld>|bol.com (legacy sync).\n",
        );
        process.exitCode = 1;
        return;
      }
      if (/google/i.test(opts.site)) {
        process.stderr.write(
          "Google matching moved to the channel API. Use --country <cc> instead of --site, or drive the loop yourself with `ssc match submit|status|results|ack`.\n",
        );
        process.exitCode = 1;
        return;
      }

      if (opts.input) {
        const code = await runStreaming({
          tool: "match",
          input: opts.input,
          globalOpts,
          buildArgs: (ean) => ({ site: opts.site, ean, deepsearch: opts.deepsearch }),
          schema: MatchInput,
          call: (c, i) => endpoints.match(c, i),
        });
        process.exitCode = code;
        return;
      }
      const code = await runCommand({
        command: "match",
        tool: "match",
        schema: MatchInput,
        rawInput: { site: opts.site, ean: opts.ean, deepsearch: opts.deepsearch },
        call: (c, i) => endpoints.match(c, i),
        globalOpts,
      });
      process.exitCode = code;
    });

  registerChannelSubcommands(match, "match");
}
