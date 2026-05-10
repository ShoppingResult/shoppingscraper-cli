import type { Command } from "commander";
import * as endpoints from "../client/endpoints.js";
import { ReviewsInput } from "../client/schemas.js";
import { type GlobalOpts, runCommand } from "./runner.js";

export function registerReviews(program: Command): void {
  program
    .command("reviews")
    .description("Fetch reviews and rating distribution for a SKU")
    .option("--site <site>", "marketplace site")
    .option("--sku <sku>", "product SKU")
    .action(async function (this: Command, opts: { site?: string; sku?: string }) {
      const code = await runCommand({
        command: "reviews",
        tool: "reviews",
        schema: ReviewsInput,
        rawInput: { site: opts.site, sku: opts.sku },
        call: (c, i) => endpoints.reviews(c, i),
        globalOpts: this.optsWithGlobals() as GlobalOpts,
      });
      process.exitCode = code;
    });
}
