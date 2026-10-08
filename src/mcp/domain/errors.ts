// Error catalog of the tools (spec 5.6). The text is what the model reads; internal
// details (raw upstream bodies, stacks) never reach it and go to the log instead.

const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'CONFLICT',
  'AUTH_INVALID',
  'FORBIDDEN',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_ERROR',
  'UPSTREAM_CONTRACT',
  'READBACK_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorDetails = {
  rule?: string;
  id?: number;
  limit?: number;
  retryAfterSeconds?: number;
  scope?: 'ip' | 'token';
  upstreamStatus?: number;
};

// The message is the bare code, so a DomainError never carries upstream text.
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, details: ErrorDetails = {}, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export const RETRYABLE: Readonly<Record<ErrorCode, boolean>> = Object.freeze({
  INVALID_INPUT: false,
  NOT_FOUND: false,
  CONFLICT: false,
  AUTH_INVALID: false,
  FORBIDDEN: false,
  RATE_LIMITED: true,
  UPSTREAM_UNAVAILABLE: true,
  UPSTREAM_ERROR: false,
  UPSTREAM_CONTRACT: false,
  READBACK_FAILED: false, // the write already happened; repeating it is never the fix
  INTERNAL: false,
});

function rateLimitText(details: ErrorDetails): string {
  const limit = details.limit === undefined ? '' : ` (${details.limit} requests/minute)`;
  const retry = details.retryAfterSeconds === undefined ? 'Retry shortly.' : `Retry in ${details.retryAfterSeconds} seconds.`;
  return `Rate limit reached${limit}. ${retry}`;
}

const TEXT: Readonly<Record<ErrorCode, (details: ErrorDetails, requestId: string) => string>> = {
  INVALID_INPUT: (d) => `Invalid input: ${d.rule ?? 'the request was rejected'}`,
  NOT_FOUND: (d) => (d.id === undefined ? 'Customer was not found.' : `Customer ${d.id} was not found.`),
  CONFLICT: () => 'Another customer already uses this email.',
  AUTH_INVALID: () => 'The configured service token is invalid, expired or revoked. Ask an administrator for a new token.',
  FORBIDDEN: () => 'This action requires the admin role; the configured token does not have it.',
  RATE_LIMITED: (d) => rateLimitText(d),
  UPSTREAM_UNAVAILABLE: () => 'The customers API is unavailable right now. Try again shortly.',
  UPSTREAM_ERROR: (_d, r) => `The customers API failed to process the request (requestId ${r}). Details were logged.`,
  UPSTREAM_CONTRACT: (_d, r) => `The customers API returned an unexpected response (requestId ${r}).`,
  READBACK_FAILED: (d, r) => `The write to customer ${d.id} was applied, but reading it back failed (requestId ${r}). Do not repeat it; use getCustomer with id ${d.id}.`,
  INTERNAL: (_d, r) => `Unexpected error (requestId ${r}).`,
};

// `[CODE] text`, exactly as in the catalog of spec 5.6.
export function errorMessage(code: ErrorCode, details: ErrorDetails, requestId: string): string {
  return `[${code}] ${TEXT[code](details, requestId)}`;
}
