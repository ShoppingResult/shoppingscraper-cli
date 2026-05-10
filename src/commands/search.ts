import { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { SearchInput } from "../client/schemas.js";
import { runCommand, type GlobalOpts } from "./runner.js";

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Search Google Shopping by keyword in a country")
    .option("--country <cc>", "country code: nl, de, fr, uk, us")
    .option("--keyword <kw>", "search query")
    .option("--page <n>", "page number (default 1)", "1")
    .action(async function (
      this: Command,
      opts: { country?: string; keyword?: string; page?: string },
    ) {
      const code = await runCommand({
        command: "search",
        tool: "search",
        schema: SearchInput,
        rawInput: {
          country: opts.country,
          keyword: opts.keyword,
          page: opts.page ? Number(opts.page) : 1,
        },
        call: (c, i) => endpoints.search(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
