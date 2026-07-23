import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { OffersInput } from "../client/schemas.js";
import {
  type ChannelPipelineOpts,
  registerChannelSubcommands,
  runChannelPipeline,
} from "./channel.js";
import { type GlobalOpts, runCommand } from "./runner.js";
import { runStreaming } from "./stream.js";

interface OffersOpts extends ChannelPipelineOpts {
  site?: string;
  availability?: boolean;
}

export function registerOffers(program: Command): void {
  const offers = program
    .command("offers")
    .description(
      "Seller offers per EAN. Google Shopping: channel API via --country (async batch, or the submit/status/results/ack subcommands). Amazon/Bol.com: legacy sync via --site.",
    )
    .option("--country <cc>", "Google Shopping market (channel API): nl, de, us, ...")
    .option("--site <site>", "legacy sync site: amazon.<tld> or bol.com")
    .option("--ean <ean>", "EAN/GTIN (8-14 digits)")
    .option(
      "--input <path>",
      "file with EANs (one per line; channel also accepts NDJSON objects), - for stdin",
    )
    .option("--availability", "legacy only: filter to in-stock offers", false)
    .option("--max-pages <n>", "channel only: pagination depth per product (1-50)")
    .option("--application-id <id>", "channel only: application scope")
    .option("--wait-timeout <seconds>", "channel only: max wait for collection (default 3600)")
    .action(async function (this: Command, opts: OffersOpts) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;

      if (opts.country) {
        process.exitCode = await runChannelPipeline("offers", opts, globalOpts);
        return;
      }

      if (!opts.site) {
        process.stderr.write(
          "Provide --country <cc> (Google Shopping, channel API) or --site amazon.<tld>|bol.com (legacy sync).\n",
        );
        process.exitCode = 1;
        return;
      }
      if (/google/i.test(opts.site)) {
        process.stderr.write(
          "Google Shopping offers moved to the channel API. Use --country <cc> instead of --site, or drive the loop yourself with `ssc offers submit|status|results|ack`.\n",
        );
        process.exitCode = 1;
        return;
      }

      if (opts.input) {
        const code = await runStreaming({
          tool: "offers",
          input: opts.input,
          globalOpts,
          buildArgs: (ean) => ({ site: opts.site, ean, availability: opts.availability }),
          schema: OffersInput,
          call: (c, i) => endpoints.offers(c, i),
        });
        process.exitCode = code;
        return;
      }
      const code = await runCommand({
        command: "offers",
        tool: "offers",
        schema: OffersInput,
        rawInput: { site: opts.site, ean: opts.ean, availability: opts.availability },
        call: (c, i) => endpoints.offers(c, i),
        globalOpts,
      });
      process.exitCode = code;
    });

  registerChannelSubcommands(offers, "offers");
}
