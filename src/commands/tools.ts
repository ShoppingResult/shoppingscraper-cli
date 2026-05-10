import { Command } from "commander";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  BuyboxInput,
  HistoryInput,
  InfoInput,
  MatchInput,
  OffersInput,
  PageInput,
  ReviewsInput,
  SearchInput,
  SubscriptionInput,
  TOOL_META,
  VariantsInput,
  type ToolName,
} from "../client/schemas.js";
import { startRun, ok } from "../output/envelope.js";
import { writeJson } from "../output/json.js";

const SCHEMAS: Record<ToolName, import("zod").ZodType<unknown>> = {
  offers: OffersInput,
  info: InfoInput,
  buybox: BuyboxInput,
  match: MatchInput,
  search: SearchInput,
  page: PageInput,
  variants: VariantsInput,
  reviews: ReviewsInput,
  credits: SubscriptionInput,
  history: HistoryInput,
};

interface ToolDescriptor {
  name: string;
  mcp_name: string;
  description: string;
  credits: number;
  requires_confirmation: boolean;
  input_schema: ReturnType<typeof zodToJsonSchema>;
}

export function listTools(): ToolDescriptor[] {
  return (Object.keys(SCHEMAS) as ToolName[]).map((name) => ({
    name,
    mcp_name: `ssc_${name}`,
    description: TOOL_META[name].description,
    credits: TOOL_META[name].credits,
    requires_confirmation: TOOL_META[name].requiresConfirmation === true,
    input_schema: zodToJsonSchema(SCHEMAS[name], { name, target: "jsonSchema7" }),
  }));
}

export function registerTools(program: Command): void {
  program
    .command("tools")
    .description("List every command/tool the CLI exposes (with JSON Schema for MCP)")
    .option("--json-schema", "output JSON Schema for each tool's input", false)
    .action(function (this: Command, opts: { jsonSchema?: boolean }) {
      const ctx = startRun("tools");
      const tools = listTools();
      const result = opts.jsonSchema
        ? tools
        : tools.map(({ name, mcp_name, description, credits, requires_confirmation }) => ({
            name,
            mcp_name,
            description,
            credits,
            requires_confirmation,
          }));
      writeJson(ok(ctx, { count: tools.length, tools: result }), false);
    });
}
