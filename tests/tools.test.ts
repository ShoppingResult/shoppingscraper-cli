import { describe, expect, it } from "vitest";
import { listTools } from "../src/commands/tools.js";

describe("listTools", () => {
  const tools = listTools();

  it("exposes every command including the channel pipeline steps", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "buybox",
        "credits",
        "history",
        "info",
        "match",
        "offers",
        "page",
        "reviews",
        "search",
        "variants",
        "offers_submit",
        "offers_status",
        "offers_results",
        "offers_ack",
        "match_submit",
        "match_status",
        "match_results",
        "match_ack",
      ].sort(),
    );
  });

  it("flags channel submits as requires_confirmation (per-EAN billing)", () => {
    for (const name of ["offers_submit", "match_submit"]) {
      const t = tools.find((x) => x.name === name);
      expect(t?.requires_confirmation, name).toBe(true);
      expect(t?.credits, name).toBe(1);
    }
  });

  it("prefixes MCP tool names with ssc_", () => {
    for (const t of tools) expect(t.mcp_name).toBe(`ssc_${t.name}`);
  });

  it("flags variants as requires_confirmation (6 credits)", () => {
    const v = tools.find((t) => t.name === "variants");
    expect(v?.credits).toBe(6);
    expect(v?.requires_confirmation).toBe(true);
  });

  it("returns valid JSON Schema for every tool", () => {
    for (const t of tools) {
      expect(t.input_schema).toBeTruthy();
      expect(typeof t.input_schema).toBe("object");
    }
  });
});
