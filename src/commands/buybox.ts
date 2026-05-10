import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { BuyboxInput } from "../client/schemas.js";
import { type GlobalOpts, runCommand } from "./runner.js";
import { runStreaming } from "./stream.js";

export function registerBuybox(program: Command): void {
  program
    .command("buybox")
    .description("Get the current buy-box winner and price for an EAN")
    .option("--site <site>", "marketplace site (amazon.* or bol.com)")
    .option("--ean <ean>", "EAN/GTIN")
    .option("--gl <country>", "country code (e.g. nl, be) for bol.com")
    .option("--hl <lang>", "language code (e.g. nl, fr) for bol.com")
    .option("--input <path>", "read EANs from file or - for stdin")
    .action(async function (
      this: Command,
      opts: { site?: string; ean?: string; gl?: string; hl?: string; input?: string },
    ) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;
      if (opts.input) {
        if (!opts.site) {
          process.stderr.write("--site is required when --input is used.\n");
          process.exitCode = 1;
          return;
        }
        const code = await runStreaming({
          tool: "buybox",
          input: opts.input,
          globalOpts,
          buildArgs: (ean) => ({ site: opts.site, ean, gl: opts.gl, hl: opts.hl }),
          schema: BuyboxInput,
          call: (c, i) => endpoints.buybox(c, i),
        });
        process.exitCode = code;
        return;
      }
      const code = await runCommand({
        command: "buybox",
        tool: "buybox",
        schema: BuyboxInput,
        rawInput: { site: opts.site, ean: opts.ean, gl: opts.gl, hl: opts.hl },
        call: (c, i) => endpoints.buybox(c, i),
        globalOpts,
      });
      process.exitCode = code;
    });
}
