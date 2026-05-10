import { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { HistoryInput } from "../client/schemas.js";
import { runCommand, type GlobalOpts } from "./runner.js";

export function registerHistory(program: Command): void {
  program
    .command("history")
    .description("Recent API call history for the current key")
    .option("--limit <n>", "max rows to return (1-500)", "50")
    .action(async function (this: Command, opts: { limit: string }) {
      const code = await runCommand({
        command: "history",
        tool: "history",
        schema: HistoryInput,
        rawInput: { limit: Number(opts.limit) },
        call: (c, i) => endpoints.subscriptionHistory(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
