import { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { VariantsInput } from "../client/schemas.js";
import { runCommand, type GlobalOpts } from "./runner.js";

export function registerVariants(program: Command): void {
  program
    .command("variants")
    .description(
      "List Google Shopping variants for a SKU. ⚠ 6 credits per call (requiresConfirmation).",
    )
    .option("--site <site>", "marketplace site (typically shopping.google.*)")
    .option("--sku <sku>", "Google Shopping product ID / catalog ID")
    .action(async function (this: Command, opts: { site?: string; sku?: string }) {
      const code = await runCommand({
        command: "variants",
        tool: "variants",
        schema: VariantsInput,
        rawInput: { site: opts.site, sku: opts.sku },
        call: (c, i) => endpoints.variants(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
