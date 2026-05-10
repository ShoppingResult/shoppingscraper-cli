/**
 * Programmatic entry point — exposes the same surface as the CLI for users
 * who want to call ShoppingScraper from their own Node code without
 * shelling out.
 */
export { HttpClient } from "./client/http.js";
export * as endpoints from "./client/endpoints.js";
export * as schemas from "./client/schemas.js";
export { TOOL_META } from "./client/schemas.js";
export { resolveConfig } from "./config.js";
export { redact, safeStringify } from "./security/redact.js";
export { runMcpServer } from "./mcp/server.js";
export { listTools } from "./commands/tools.js";
export { VERSION } from "./version.js";
export { SscError, EXIT_CODES } from "./errors.js";
export type { Envelope, EnvelopeMeta, EnvelopeError } from "./output/envelope.js";
