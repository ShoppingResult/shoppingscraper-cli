import { randomBytes } from "node:crypto";
import { ENVELOPE_VERSION } from "../version.js";
import { SscError } from "../errors.js";
import { redact } from "../security/redact.js";

export interface EnvelopeMeta {
  credits_remaining?: number;
  credits_spent?: number;
  duration_ms: number;
  request_id: string;
  [k: string]: unknown;
}

export interface EnvelopeError {
  code: string;
  message: string;
  http_status?: number;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface Envelope<T> {
  _v: number;
  ok: boolean;
  command: string;
  result: T | null;
  error: EnvelopeError | null;
  meta: EnvelopeMeta;
}

export function newRequestId(): string {
  return `ssc_${randomBytes(8).toString("hex")}`;
}

export interface RunContext {
  command: string;
  startedAt: number;
  requestId: string;
}

export function startRun(command: string): RunContext {
  return {
    command,
    startedAt: Date.now(),
    requestId: newRequestId(),
  };
}

export function ok<T>(
  ctx: RunContext,
  result: T,
  meta: Partial<EnvelopeMeta> = {},
): Envelope<T> {
  return {
    _v: ENVELOPE_VERSION,
    ok: true,
    command: ctx.command,
    result: redact(result) as T,
    error: null,
    meta: {
      duration_ms: Date.now() - ctx.startedAt,
      request_id: ctx.requestId,
      ...meta,
    },
  };
}

export function fail(
  ctx: RunContext,
  err: unknown,
  meta: Partial<EnvelopeMeta> = {},
): Envelope<null> {
  const sscErr = toSscError(err);
  return {
    _v: ENVELOPE_VERSION,
    ok: false,
    command: ctx.command,
    result: null,
    error: redact(sscErr.toEnvelopeError()) as EnvelopeError,
    meta: {
      duration_ms: Date.now() - ctx.startedAt,
      request_id: ctx.requestId,
      ...meta,
    },
  };
}

export function toSscError(err: unknown): SscError {
  if (err instanceof SscError) return err;
  if (err instanceof Error) {
    return new SscError("UPSTREAM_ERROR", err.message, { cause: err });
  }
  return new SscError("UPSTREAM_ERROR", String(err));
}
