import { HttpErrorResponse } from '@angular/common/http';

/** The single typed error shape for Fineract failures, and the mapper that builds it from an Angular `HttpErrorResponse` (AAP 0.7.1 row "`ApiError` + mapper"; AAP 0.7.2 row `FineractError`) (Rule 1 clause 3, AAP 0.4.4, AAP 0.14.1). */

/** One field-level failure of the Fineract error envelope (AAP 0.7.2). */
export interface FineractValidationError {
  /** The failure's own text, exactly as the server sent it. */
  readonly defaultUserMessage: string;
  /** Name of the request field the failure belongs to, when the server names one. */
  readonly parameterName?: string;
  /** Translation key the server offers for the failure, kept as received and never resolved here. */
  readonly userMessageGlobalisationCode?: string;
}

/** Fineract's error envelope as modelled for the in-scope screens, under the name AAP 0.7.2's model table gives it (row `FineractError`). */
export interface FineractError {
  /** The envelope's own text, as the server sent it; the message used when no `errors` entry carries text. */
  readonly defaultUserMessage?: string;
  /** Translation key the envelope's declared shape carries for the whole failure (AAP 0.7.2 row `FineractError`), deliberately not carried by `readFineractErrorBody`: every in-scope screen renders Fineract's own (Rule 1 clause 3). */
  readonly userMessageGlobalisationCode?: string;
  /** Field-level failures in the server's order; the first one carrying text, written for the user, becomes the message (qaw007-F02). */
  errors?: FineractValidationError[];
}

/** A displayable Fineract failure: `message` is the server's own text and is rendered verbatim. */
export class ApiError extends Error {
  /** HTTP status the failure arrived with; `0` marks a transport failure and is reported as-is. */
  readonly status: number;

  /** The envelope's field-level failures in the server's order, empty when it named none. */
  readonly validationErrors: readonly FineractValidationError[];

  /** @param message Server text, verbatim, or the fallback `toApiError` settled on. @param status HTTP status of the failed response. @param validationErrors Field-level failures received with it. */
  constructor(
    message: string,
    status: number,
    validationErrors: readonly FineractValidationError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.validationErrors = validationErrors;
    // Keeps `instanceof ApiError` true when the class is down-levelled: the interceptor and the auth spec both rely on it.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Whether one entry of `errors` carries the text `validationErrors` reports (AAP 0.7.2). */
function isFineractValidationError(value: unknown): value is FineractValidationError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as { defaultUserMessage?: unknown }).defaultUserMessage === 'string';
}

/** Reads `HttpErrorResponse.error`, which is `unknown` by declaration: an object for a body the server sent, a string when something in between answered with text, a `ProgressEvent` when the transport itself failed (AAP 0.7.2, Rule 1 clause 3). */
function readFineractErrorBody(value: unknown): FineractError | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { defaultUserMessage?: unknown; errors?: unknown };
  const defaultUserMessage =
    typeof candidate.defaultUserMessage === 'string' ? candidate.defaultUserMessage : undefined;
  const errors: FineractValidationError[] = Array.isArray(candidate.errors)
    ? candidate.errors.filter(isFineractValidationError)
    : [];
  if (defaultUserMessage === undefined && errors.length === 0) {
    return undefined;
  }
  return defaultUserMessage === undefined ? { errors } : { defaultUserMessage, errors };
}

/** The text a failure becomes when no server message reached it (AAP 0.7.2). */
const UNMAPPED_FAILURE = 'The request could not be completed.';

/** The shapes a message takes when it is a database's, a driver's or a framework's own words rather than text written for the user, so that such a message is recognised instead of being rendered.
 *
 * An ordinary Fineract message is still surfaced verbatim, which is the behavioural inheritance AAP 0.4.4 decision 6 records for every `errors[].defaultUserMessage` and what AAP 0.7.4 renders above a form. A message carrying database or driver internals is not a message written for a user, and it is replaced by `UNMAPPED_FAILURE` — the sentence that keeps PostgreSQL's failure, the prepared statement that carried the request and the backend's framework class names out of the rendered error region without changing how an ordinary Fineract failure is shown. The fork's own exception mapping is out of this work's scope (AAP 0.9.2), so the application is where this is settled.
 *
 * Each pattern is deliberately narrow: an ordinary message that merely contains the word "error" or "where" in prose does not match, so nothing beyond the database's own words is ever replaced.
 *
 * Rule 1 clause 3 keeps legacy's error messages as they are, and this file departs from it for a database's, a driver's or a framework's own words alone: such text reports the server's internal failure, the statement that carried the request or a framework class inside the backend, and an error response must not carry any of those into the rendered region. */
const BACKEND_INTERNAL_PATTERNS: readonly RegExp[] = [
  /** PostgreSQL's own `ERROR:` line, which opens the server-side failure it reports — e.g. `Unknown data integrity issue with resource: ERROR: relation "m_client" does not exist`. */
  /\bERROR:\s/,
  /** A character-encoding failure of the database's, e.g. `invalid byte sequence for encoding "UTF8": 0x00`. */
  /\binvalid byte sequence\b/i,
  /** A prepared statement's parameter dump, e.g. `Where: unnamed portal parameter $7`. */
  /\bunnamed portal parameter\b/i,
  /** An SQLState the driver reports, e.g. `could not execute statement; SQLState [23505]`. */
  /\bSQLState\b/,
  /** A driver or framework class name, e.g. `org.springframework.dao.DataIntegrityViolationException` or `org.postgresql.util.…`. */
  /\borg\.(?:postgresql|hibernate|springframework)\.[A-Za-z]/,
  /** A driver exception type, e.g. `PSQLException: could not receive the response`. */
  /\bPSQLException\b/,
];

/** Whether a message carries a database's, a driver's or a framework's own words rather than text written for the user (qaw007-F02, AAP 0.9.2). Answering `false` keeps an ordinary Fineract message in front of the user verbatim (AAP 0.4.4 decision 6, AAP 0.7.4). @param message one candidate message exactly as the server sent it. @returns `true` when the text matches any of {@link BACKEND_INTERNAL_PATTERNS}. */
function carriesBackendInternals(message: string): boolean {
  return BACKEND_INTERNAL_PATTERNS.some((pattern) => pattern.test(message));
}

/** Builds the displayable error from a failed response, choosing its message in this order and returning the first candidate that carries text and is written for the user: the first `errors[].defaultUserMessage` that is neither empty nor a database's or driver's own words, in the server's order, then the envelope's own `defaultUserMessage` under the same test, and `UNMAPPED_FAILURE` when neither qualifies (AAP 0.4.4 decision 6, AAP 0.7.4, AAP 0.9.2; qaw007-F02). The status and the field-level failures are carried exactly as received, so a screen still paints a 4xx inline and the guard against database internals changes nothing but the sentence (AAP 0.7.2, AAP 0.7.4). */
export function toApiError(response: HttpErrorResponse): ApiError {
  const body = readFineractErrorBody(response.error);
  const validationErrors: readonly FineractValidationError[] = body?.errors ?? [];
  const candidates: readonly string[] = [
    ...validationErrors.map((failure) => failure.defaultUserMessage),
    body?.defaultUserMessage ?? '',
  ];
  const message =
    candidates.find((candidate) => candidate !== '' && !carriesBackendInternals(candidate)) ??
    UNMAPPED_FAILURE;

  return new ApiError(message, response.status, validationErrors);
}

/** Reads whatever a rejected request produced into the one error type a screen renders (Rule 1 clause 3, Rule 1 clause 9). */
export function toDisplayableFailure(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }

  if (cause instanceof HttpErrorResponse) {
    return toApiError(cause);
  }

  const message = cause instanceof Error && cause.message !== '' ? cause.message : UNMAPPED_FAILURE;

  return new ApiError(message, 0);
}

/** Reads a refused navigation into the one error type a screen renders (AAP 0.4.4, Rule 1 clause 3). */
export function navigationFailure(cause: unknown, destination: string): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }

  if (cause instanceof HttpErrorResponse) {
    return toApiError(cause);
  }

  return new ApiError(`The ${destination} did not open. Reload the page and try again.`, 0);
}

/** The failure a screen paints inline, or `null` when the interceptor has already reported it (AAP 0.7.4, AAP 0.14.2). */
export function screenFailure(cause: unknown): ApiError | null {
  const failure = toDisplayableFailure(cause);

  return failure.status >= 400 && failure.status < 500 ? failure : null;
}
