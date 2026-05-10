export type ErrorCode =
  | "USER_ERROR"
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "SPEND_CAP_EXCEEDED"
  | "NOT_FOUND"
  | "INVALID_RESPONSE";

export const EXIT_CODES: Record<ErrorCode, number> = {
  USER_ERROR: 1,
  AUTH_MISSING: 2,
  AUTH_INVALID: 2,
  RATE_LIMITED: 3,
  UPSTREAM_ERROR: 4,
  NETWORK_ERROR: 5,
  SPEND_CAP_EXCEEDED: 6,
  NOT_FOUND: 4,
  INVALID_RESPONSE: 4,
};

export class SscError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      httpStatus?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "SscError";
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  exitCode(): number {
    return EXIT_CODES[this.code];
  }

  toEnvelopeError(): {
    code: ErrorCode;
    message: string;
    http_status?: number;
    retryable: boolean;
    details?: Record<string, unknown>;
  } {
    const out: ReturnType<SscError["toEnvelopeError"]> = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.httpStatus !== undefined) out.http_status = this.httpStatus;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}
