import { Command } from "commander";
import { runMcpServer } from "../mcp/server.js";

export function registerMcp(program: Command): void {
  const mcp = program.command("mcp").description("MCP (Model Context Protocol) server commands");

  mcp
    .command("serve")
    .description("Run an MCP server over stdio. Wire it into Claude Desktop / Cursor / Code.")
    .action(async () => {
      try {
        await runMcpServer();
      } catch (err) {
        process.stderr.write(`[ssc-mcp] startup failed: ${(err as Error).message}\n`);
        process.exitCode = 2;
      }
    });
}
