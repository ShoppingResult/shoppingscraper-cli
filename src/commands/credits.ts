import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { SubscriptionInput } from "../client/schemas.js";
import { type GlobalOpts, runCommand } from "./runner.js";

export function registerCredits(program: Command): void {
  program
    .command("credits")
    .description("Show remaining credits and plan info")
    .action(async function (this: Command) {
      const code = await runCommand({
        command: "credits",
        tool: "credits",
        schema: SubscriptionInput,
        rawInput: {},
        call: (c, i) => endpoints.subscription(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
