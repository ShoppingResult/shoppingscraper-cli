import { describe, expect, it } from "vitest";
import { listTools } from "../src/commands/tools.js";

describe("listTools", () => {
  const tools = listTools();

  it("exposes every v1 command", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["buybox", "credits", "history", "info", "match", "offers", "page", "reviews", "search", "variants"].sort(),
    );
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
