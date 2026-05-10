import { safeStringify } from "../security/redact.js";
import type { Envelope } from "./envelope.js";

export function writeJson(env: Envelope<unknown>, pretty = false): void {
  const out = safeStringify(env, pretty ? 2 : undefined);
  process.stdout.write(`${out}\n`);
}

export function writeJsonLine(env: Envelope<unknown>): void {
  process.stdout.write(`${safeStringify(env)}\n`);
}
