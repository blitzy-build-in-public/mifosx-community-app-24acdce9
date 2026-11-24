import type { HttpErrorResponse } from '@angular/common/http';

/**
 * The single typed error shape for Fineract failures, and the mapper that builds it from an
 * Angular `HttpErrorResponse` (AAP 0.7.1 row "`ApiError` + mapper"; AAP 0.7.2 row `FineractError`).
 *
 * `toApiError` chooses the message in this order and stops at the first non-empty string: the
 * body's `defaultUserMessage`; the first `errors[].defaultUserMessage` carrying text; Angular's
 * own `message` for the failure; then `HTTP <status>`.
 *
 * Parity rule (Rule 1 clause 3; AAP 0.4.4 decision 6): the chosen text is surfaced verbatim — no
 * prefix, suffix, trim, case change, translation or added punctuation — because workflow W7
 * compares the message a screen shows character for character with the server's
 * `defaultUserMessage`. Nothing from the request, its headers or its body is read into it, so a
 * session credential can never reach a screen, a log or a captured exchange.
 *
 * `ApiError` is the only error type a service returns (AAP 0.14.1): a component renders
 * `message`, may render `validationErrors` per field, and keeps its form state.
 */

/** One field-level failure of the Fineract error envelope (AAP 0.7.2). */
export interface FineractValidationError {
  /** The failure's own text, exactly as the server sent it. */
  readonly defaultUserMessage: string;

  /** Name of the request field the failure belongs to, when the server names one. */
  readonly parameterName?: string;

  /** Translation key the server offers for the failure, kept as received and never resolved here. */
  readonly userMessageGlobalisationCode?: string;
}

/**
 * Fineract's error envelope as modelled for the in-scope screens (AAP 0.7.2 row `FineractError`).
 * Every field is optional: a validation failure returns this body, while a platform-level failure
 * (an unmapped path, an authentication refusal, a transport fault) returns a body of another shape
 * or none, and then the later fallbacks in `toApiError` carry the message.
 */
export interface FineractErrorBody {
  /** The failure's own text, as the server sent it; the message preferred above every other. */
  readonly defaultUserMessage?: string;

  /** Translation key the server offers for the whole failure, kept as received. */
  readonly userMessageGlobalisationCode?: string;

  /** Field-level failures in the server's order; the first carrying text becomes the message. */
  errors?: FineractValidationError[];
}

/** A displayable Fineract failure: `message` is the server's own text and is rendered verbatim. */
export class ApiError extends Error {
  /** HTTP status the failure arrived with; `0` marks a transport failure and is reported as-is. */
  readonly status: number;

  /** The envelope's field-level failures in the server's order, empty when it named none. */
  readonly validationErrors: readonly FineractValidationError[];

  /**
   * @param message Server text, verbatim, or the fallback `toApiError` settled on.
   * @param status HTTP status of the failed response.
   * @param validationErrors Field-level failures received with it.
   */
  constructor(
    message: string,
    status: number,
    validationErrors: readonly FineractValidationError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.validationErrors = validationErrors;
    // Keeps `instanceof ApiError` true when the class is down-levelled: the interceptor and the
    // auth spec both rely on it.
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

/**
 * Reads `HttpErrorResponse.error`, which is `unknown` by declaration: an object for a body the
 * server sent, a string when something in between answered with text, a `ProgressEvent` when the
 * transport itself failed. This reader is the single documented boundary where that loosely typed
 * value is narrowed, and it normalises rather than rejects: the body's `defaultUserMessage` is
 * kept whenever it is a string, whatever its `errors` member holds, and `errors` is kept as the
 * entries that conform — in the server's order — with a member of another shape counted as
 * absent. It answers `undefined` for `null`, a primitive, an array, and a body yielding neither,
 * so the later fallbacks in `toApiError` carry the message (AAP 0.7.2 row `FineractError`).
 */
function readFineractErrorBody(value: unknown): FineractErrorBody | undefined {
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

/**
 * Builds the displayable error from a failed response, choosing its message in this order and
 * returning the first non-empty string unchanged: the body's `defaultUserMessage`; the first
 * `errors[].defaultUserMessage` carrying text; Angular's own `message` for the failure; then
 * `HTTP <status>`. A blank entry counts as absent, an absent or malformed member of the body is
 * passed over rather than costing the body its other members, and nothing else about the chosen
 * string is altered, so the text a screen shows is the text the server sent (workflow W7).
 *
 * @param response The failed response Angular produced.
 * @returns The one error type a service returns, carrying the status and the field-level failures.
 */
export function toApiError(response: HttpErrorResponse): ApiError {
  const body = readFineractErrorBody(response.error);
  const validationErrors: readonly FineractValidationError[] = body?.errors ?? [];
  const candidates: readonly string[] = [
    body?.defaultUserMessage ?? '',
    ...validationErrors.map((failure) => failure.defaultUserMessage),
    response.message,
  ];
  const message = candidates.find((candidate) => candidate !== '') ?? `HTTP ${response.status}`;

  return new ApiError(message, response.status, validationErrors);
}
