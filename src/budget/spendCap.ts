import { TOOL_META, type ToolName } from "../client/schemas.js";
import { SscError } from "../errors.js";

/**
 * Local-only credit-spend guardrail. This is the *advisory* layer (codex's
 * "client-side mandatory + advisory"). The real brake is the ShoppingScraper
 * API server's max-credits-per-call / per-key-daily caps — anything here can
 * be bypassed by talking to the API directly. Don't market this as security.
 */

export interface SpendCheck {
  tool: ToolName;
  count: number;
  cap: number | null;
}

export function estimateCost(tool: ToolName, count: number): number {
  return TOOL_META[tool].credits * count;
}

export function ensureWithinCap(tool: ToolName, count: number, cap: number | null): void {
  if (cap === null) return;
  const cost = estimateCost(tool, count);
  if (cost > cap) {
    throw new SscError(
      "SPEND_CAP_EXCEEDED",
      `would spend ${cost} credits (${count} × ${TOOL_META[tool].credits}) but --max-spend-credits is ${cap}. Raise the cap or reduce input.`,
      { details: { estimated_cost: cost, cap, count, per_call_cost: TOOL_META[tool].credits } },
    );
  }
}

/**
 * Special-case enforcement for `ssc batch` — no cap means refuse, period.
 * This is mandatory because batch is the highest-blast-radius operation an
 * agent can invoke via MCP.
 */
export function ensureBatchCapPresent(cap: number | null): void {
  if (cap === null) {
    throw new SscError(
      "USER_ERROR",
      "ssc batch requires --max-spend-credits N (no default). Set an explicit cap before running.",
    );
  }
}
