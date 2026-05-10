import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { MatchInput } from "../client/schemas.js";
import { type GlobalOpts, runCommand } from "./runner.js";
import { runStreaming } from "./stream.js";

export function registerMatch(program: Command): void {
  program
    .command("match")
    .description("Match an EAN to a marketplace SKU/URL. --deepsearch costs 4 credits.")
    .option("--site <site>", "marketplace site")
    .option("--ean <ean>", "EAN/GTIN")
    .option("--deepsearch", "thorough match (4 credits, advisory: requires confirmation)", false)
    .option("--input <path>", "read EANs from file or - for stdin")
    .action(async function (
      this: Command,
      opts: { site?: string; ean?: string; deepsearch?: boolean; input?: string },
    ) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;
      if (opts.input) {
        if (!opts.site) {
          process.stderr.write("--site is required when --input is used.\n");
          process.exitCode = 1;
          return;
        }
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
}
