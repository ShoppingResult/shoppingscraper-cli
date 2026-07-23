import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ensureWithinCap } from "../budget/spendCap.js";
import * as endpoints from "../client/endpoints.js";
import {
  BuyboxInput,
  ChannelAckInput,
  ChannelResultsInput,
  ChannelStatusInput,
  ChannelSubmitInput,
  HistoryInput,
  InfoInput,
  MatchInput,
  OffersInput,
  PageInput,
  ReviewsInput,
  SearchInput,
  SubscriptionInput,
  TOOL_META,
  type ToolName,
  VariantsInput,
} from "../client/schemas.js";
import { makeClient } from "../commands/runner.js";
import { resolveConfig } from "../config.js";
import { fail, ok, startRun } from "../output/envelope.js";
import { redact, safeStringify } from "../security/redact.js";
import { VERSION } from "../version.js";

interface ToolEntry<I, O> {
  name: ToolName;
  schema: import("zod").ZodType<I>;
  call: (
    client: import("../client/http.js").HttpClient,
    input: I,
  ) => Promise<import("../client/endpoints.js").CallResult<O>>;
}

const TOOLS: ToolEntry<unknown, unknown>[] = [
  { name: "offers", schema: OffersInput, call: (c, i) => endpoints.offers(c, i as never) },
  { name: "info", schema: InfoInput, call: (c, i) => endpoints.info(c, i as never) },
  { name: "buybox", schema: BuyboxInput, call: (c, i) => endpoints.buybox(c, i as never) },
  { name: "match", schema: MatchInput, call: (c, i) => endpoints.match(c, i as never) },
  { name: "search", schema: SearchInput, call: (c, i) => endpoints.search(c, i as never) },
  { name: "page", schema: PageInput, call: (c, i) => endpoints.page(c, i as never) },
  { name: "variants", schema: VariantsInput, call: (c, i) => endpoints.variants(c, i as never) },
  { name: "reviews", schema: ReviewsInput, call: (c, i) => endpoints.reviews(c, i as never) },
  {
    name: "credits",
    schema: SubscriptionInput,
    call: (c, i) => endpoints.subscription(c, i as never),
  },
  {
    name: "history",
    schema: HistoryInput,
    call: (c, i) => endpoints.subscriptionHistory(c, i as never),
  },
  // Channel API (async batch pipeline for Google Shopping). The MCP surface
  // exposes the raw steps; the agent drives submit → status → results → ack.
  {
    name: "offers_submit",
    schema: ChannelSubmitInput,
    call: (c, i) => endpoints.channelSubmit(c, "offers", i as never),
  },
  {
    name: "offers_status",
    schema: ChannelStatusInput,
    call: (c, i) => endpoints.channelStatus(c, "offers", i as never),
  },
  {
    name: "offers_results",
    schema: ChannelResultsInput,
    call: (c, i) => endpoints.channelResults(c, "offers", i as never),
  },
  {
    name: "offers_ack",
    schema: ChannelAckInput,
    call: (c, i) => endpoints.channelAck(c, "offers", i as never),
  },
  {
    name: "match_submit",
    schema: ChannelSubmitInput,
    call: (c, i) => endpoints.channelSubmit(c, "match", i as never),
  },
  {
    name: "match_status",
    schema: ChannelStatusInput,
    call: (c, i) => endpoints.channelStatus(c, "match", i as never),
  },
  {
    name: "match_results",
    schema: ChannelResultsInput,
    call: (c, i) => endpoints.channelResults(c, "match", i as never),
  },
  {
    name: "match_ack",
    schema: ChannelAckInput,
    call: (c, i) => endpoints.channelAck(c, "match", i as never),
  },
];

function describe(name: ToolName): string {
  const meta = TOOL_META[name];
  const tags: string[] = [];
  tags.push(`Cost: ${meta.credits} credit${meta.credits === 1 ? "" : "s"} per call.`);
  if (meta.requiresConfirmation) {
    tags.push(
      "ADVISORY: requiresConfirmation — host SHOULD prompt the user before invocation. Note: this is advisory only; the only enforced spend cap is server-side and the CLI's --max-spend-credits.",
    );
  }
  return `${meta.description} ${tags.join(" ")}`;
}

export async function runMcpServer(): Promise<void> {
  // Resolve config eagerly so the user sees auth errors at startup, not on
  // first tool call.
  resolveConfig();

  const server = new Server(
    { name: "shoppingscraper", version: VERSION },
    { capabilities: { tools: {} } },
  );

  const toolList: Tool[] = TOOLS.map((t) => ({
    name: `ssc_${t.name}`,
    description: describe(t.name),
    inputSchema: zodToJsonSchema(t.schema, {
      name: t.name,
      target: "jsonSchema7",
    }) as Tool["inputSchema"],
    annotations: TOOL_META[t.name].requiresConfirmation
      ? {
          // Hint to MCP hosts (e.g. Claude Desktop) — advisory only.
          destructiveHint: false,
          openWorldHint: true,
          requiresConfirmation: true,
        }
      : { destructiveHint: false, openWorldHint: true },
  }));

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolList }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOLS.find((t) => `ssc_${t.name}` === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      };
    }
    const ctx = startRun(tool.name);
    const cfg = resolveConfig();

    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const env = fail(ctx, new Error(parsed.error.message));
      return {
        isError: true,
        content: [{ type: "text", text: safeStringify(env, 2) }],
      };
    }

    try {
      // Channel submits bill per item, not per call — cap on the item count.
      const items = (parsed.data as { items?: unknown[] }).items;
      const count = Array.isArray(items) ? items.length : 1;
      ensureWithinCap(tool.name, count, cfg.maxSpendCredits);
    } catch (err) {
      const env = fail(ctx, err);
      return {
        isError: true,
        content: [{ type: "text", text: safeStringify(env, 2) }],
      };
    }

    const client = makeClient(cfg);
    try {
      const r = await tool.call(client, parsed.data);
      const meta: Record<string, unknown> = {};
      if (r.creditsRemaining !== undefined) meta.credits_remaining = r.creditsRemaining;
      if (r.creditsSpent !== undefined) meta.credits_spent = r.creditsSpent;
      const env = ok(ctx, redact(r.data), meta);
      return {
        content: [{ type: "text", text: safeStringify(env, 2) }],
      };
    } catch (err) {
      const env = fail(ctx, err);
      return {
        isError: true,
        content: [{ type: "text", text: safeStringify(env, 2) }],
      };
    } finally {
      await client.close();
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[ssc-mcp] ready (v${VERSION}, ${toolList.length} tools)\n`);
}
