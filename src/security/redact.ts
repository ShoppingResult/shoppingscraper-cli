/**
 * Redaction layer — every error message, log line, request_id, and envelope
 * meta field passes through here before it leaves the process. Never trust
 * upstream payloads to be key-free.
 *
 * Two patterns are scrubbed aggressively:
 *   1. `api_key=<value>` (and `apikey=`, `api-key=`) inside any string —
 *      ShoppingScraper auth lives in the URL query string, so URLs in stack
 *      traces, error messages, and user-agent debug strings can leak it.
 *   2. UUID-shaped strings (8-4-4-4-12 hex) anywhere — the format the
 *      ShoppingScraper API uses for keys today. Conservative on purpose: if
 *      a real product UUID gets redacted in a log, we lose nothing; if a key
 *      slips through, we lose money.
 */

// Match UUID-shape anywhere — including immediately after `_` (e.g. `ssc_<uuid>`)
// or `:` (e.g. headers). \b doesn't consider `_` a boundary, so we use a
// negative-lookbehind/ahead on hex chars instead.
const UUID_PATTERN =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;
const QUERY_KEY_PATTERN = /([?&](?:api[_-]?key))=([^&\s"']+)/gi;
const HEADER_KEY_PATTERN = /\b(x-api-key|authorization)\s*[:=]\s*["']?([^"'\s,]+)/gi;

const REDACTED = "[REDACTED]";

export function redactString(input: string): string {
  return input
    .replace(QUERY_KEY_PATTERN, `$1=${REDACTED}`)
    .replace(HEADER_KEY_PATTERN, `$1: ${REDACTED}`)
    .replace(UUID_PATTERN, REDACTED);
}

/**
 * Recursively redact a value. Strings get pattern-stripped, objects/arrays
 * get walked. Sensitive-looking keys (api_key, apiKey, token, secret, etc.)
 * have their values fully replaced. Cycles short-circuit safely.
 */
export function redact<T>(value: T): T {
  return redactWithSeen(value, new WeakSet()) as T;
}

const SENSITIVE_KEY_PATTERN = /api[_-]?key|apikey|secret|token|password|authorization/i;

function redactWithSeen(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return "[CIRCULAR]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactWithSeen(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactWithSeen(v, seen);
    }
  }
  return out;
}

/**
 * Redact then JSON-stringify. Use anywhere structured output leaves the process
 * (envelope writer, error logger, request_id meta, debug traces).
 */
export function safeStringify(value: unknown, space?: number): string {
  return JSON.stringify(redact(value), null, space);
}
