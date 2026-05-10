import pc from "picocolors";
import type { Envelope } from "./envelope.js";
import { redact } from "../security/redact.js";

/**
 * Minimal pretty printer. Not a full table renderer — just enough to make
 * common outputs (offers, info, credits) readable in a terminal. Falls back
 * to formatted JSON for shapes we don't have a special view for.
 */
export function writePretty(env: Envelope<unknown>): void {
  if (!env.ok || env.error) {
    process.stderr.write(
      `${pc.red("✗")} ${pc.bold(env.command)}: ${env.error?.message ?? "unknown error"}\n`,
    );
    if (env.error?.code) {
      process.stderr.write(`  ${pc.dim("code:")} ${env.error.code}\n`);
    }
    if (env.error?.http_status) {
      process.stderr.write(`  ${pc.dim("http:")} ${env.error.http_status}\n`);
    }
    return;
  }

  const safe = redact(env.result);
  process.stdout.write(`${pc.green("✓")} ${pc.bold(env.command)}\n`);
  process.stdout.write(`${formatValue(safe, "  ")}\n`);
  if (env.meta.credits_remaining !== undefined) {
    process.stdout.write(
      `${pc.dim(`credits remaining: ${env.meta.credits_remaining} · ${env.meta.duration_ms}ms`)}\n`,
    );
  } else {
    process.stdout.write(`${pc.dim(`${env.meta.duration_ms}ms`)}\n`);
  }
}

function formatValue(value: unknown, indent: string): string {
  if (value === null || value === undefined) return `${indent}${pc.dim("null")}`;
  if (typeof value === "string") return `${indent}${value}`;
  if (typeof value === "number" || typeof value === "boolean") return `${indent}${String(value)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}${pc.dim("(empty)")}`;
    return value
      .map((v, i) => {
        if (typeof v === "object" && v !== null) {
          return `${indent}${pc.cyan(`[${i}]`)}\n${formatValue(v, `${indent}  `)}`;
        }
        return `${indent}${pc.cyan(`[${i}]`)} ${String(v)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${indent}${pc.dim("(empty)")}`;
    return entries
      .map(([k, v]) => {
        if (v === null || v === undefined) return `${indent}${pc.cyan(k)}: ${pc.dim("null")}`;
        if (typeof v !== "object") return `${indent}${pc.cyan(k)}: ${String(v)}`;
        return `${indent}${pc.cyan(k)}:\n${formatValue(v, `${indent}  `)}`;
      })
      .join("\n");
  }
  return `${indent}${String(value)}`;
}
