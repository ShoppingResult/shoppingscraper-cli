import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { PageInput } from "../client/schemas.js";
import { type GlobalOpts, runCommand } from "./runner.js";

export function registerPage(program: Command): void {
  program
    .command("page")
    .description("Extract structured product data from a product URL")
    .option("--url <url>", "product page URL")
    .action(async function (this: Command, opts: { url?: string }) {
      const code = await runCommand({
        command: "page",
        tool: "page",
        schema: PageInput,
        rawInput: { url: opts.url },
        call: (c, i) => endpoints.page(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
