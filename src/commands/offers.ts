import { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { OffersInput } from "../client/schemas.js";
import { runCommand, type GlobalOpts } from "./runner.js";
import { runStreaming } from "./stream.js";

export function registerOffers(program: Command): void {
  program
    .command("offers")
    .description("List all seller offers for an EAN on a marketplace")
    .option("--site <site>", "marketplace site (e.g. amazon.de, bol.com, shopping.google.nl)")
    .option("--ean <ean>", "EAN/GTIN (8-14 digits)")
    .option("--availability", "filter to in-stock offers only", false)
    .option("--input <path>", "read EANs (one per line) from file or - for stdin")
    .action(async function (
      this: Command,
      opts: { site?: string; ean?: string; availability?: boolean; input?: string },
    ) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;
      if (opts.input) {
        if (!opts.site) {
          process.stderr.write("--site is required when --input is used.\n");
          process.exitCode = 1;
          return;
        }
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
}
