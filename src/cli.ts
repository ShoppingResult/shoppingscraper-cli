import { Command, Option } from "commander";
import { registerBatch } from "./commands/batch.js";
import { registerBuybox } from "./commands/buybox.js";
import { registerCredits } from "./commands/credits.js";
import { registerHistory } from "./commands/history.js";
import { registerInfo } from "./commands/info.js";
import { registerMatch } from "./commands/match.js";
import { registerMcp } from "./commands/mcp.js";
import { registerOffers } from "./commands/offers.js";
import { registerPage } from "./commands/page.js";
import { registerReviews } from "./commands/reviews.js";
import { registerSearch } from "./commands/search.js";
import { registerTools } from "./commands/tools.js";
import { registerVariants } from "./commands/variants.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("ssc")
  .description(
    "ShoppingScraper CLI — agent-friendly interface for the ShoppingScraper API. Stable JSON envelope on every command, MCP server mode via `ssc mcp serve`, ships SKILL.md.",
  )
  .version(VERSION, "-v, --version")
  .addOption(
    new Option(
      "--api-key <key>",
      "API key (prefer SSC_API_KEY env var; flag lands in shell history)",
    ).env("SSC_API_KEY"),
  )
  .option("--pretty", "human-readable output instead of JSON envelope", false)
  .option("--quiet", "suppress stdout (only exit code)", false)
  .option("--timeout <seconds>", "per-request timeout in seconds", "30")
  .option("--retries <n>", "retry count on transient failures", "2")
  .option("--concurrency <n>", "max concurrent requests for --input streaming", "5")
  .option(
    "--max-spend-credits <n|none>",
    "soft cap on credits a single command may spend (default 100, 'none' to disable)",
    "100",
  )
  .addOption(new Option("--base-url <url>", "override API base URL (advanced)").env("SSC_BASE_URL"))
  .addOption(
    new Option("--app-base-url <url>", "override app base URL (advanced)").env("SSC_APP_BASE_URL"),
  )
  .addOption(
    new Option("--channel-base-url <url>", "override channel API base URL (advanced)").env(
      "SSC_CHANNEL_BASE_URL",
    ),
  );

registerCredits(program);
registerHistory(program);
registerOffers(program);
registerInfo(program);
registerBuybox(program);
registerMatch(program);
registerSearch(program);
registerPage(program);
registerVariants(program);
registerReviews(program);
registerBatch(program);
registerTools(program);
registerMcp(program);

program.showHelpAfterError("(run `ssc --help` for usage)");

await program.parseAsync(process.argv);
