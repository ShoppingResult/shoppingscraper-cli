import { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { InfoInput } from "../client/schemas.js";
import { runCommand, type GlobalOpts } from "./runner.js";
import { runStreaming } from "./stream.js";

export function registerInfo(program: Command): void {
  program
    .command("info")
    .description("Fetch product info (title, brand, images, specs) for an EAN")
    .option("--site <site>", "marketplace site")
    .option("--ean <ean>", "EAN/GTIN (8-14 digits)")
    .option("--input <path>", "read EANs from file or - for stdin")
    .action(async function (this: Command, opts: { site?: string; ean?: string; input?: string }) {
      const globalOpts = this.optsWithGlobals() as GlobalOpts;
      if (opts.input) {
        if (!opts.site) {
          process.stderr.write("--site is required when --input is used.\n");
          process.exitCode = 1;
          return;
        }
        const code = await runStreaming({
          tool: "info",
          input: opts.input,
          globalOpts,
          buildArgs: (ean) => ({ site: opts.site, ean }),
          schema: InfoInput,
          call: (c, i) => endpoints.info(c, i),
        });
        process.exitCode = code;
        return;
      }
      const code = await runCommand({
        command: "info",
        tool: "info",
        schema: InfoInput,
        rawInput: { site: opts.site, ean: opts.ean },
        call: (c, i) => endpoints.info(c, i),
        globalOpts,
      });
      process.exitCode = code;
    });
}
