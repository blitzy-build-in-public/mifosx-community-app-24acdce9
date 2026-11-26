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
  /** Field-level failures in the server's order; the first carrying text becomes the message. */
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

/** Builds the displayable error from a failed response, choosing its message in this order and returning the first non-empty string unchanged: the first `errors[].defaultUserMessage` carrying text, in the server's order (AAP 0.4.4, Rule 1 clause 3). */
export function toApiError(response: HttpErrorResponse): ApiError {
  const body = readFineractErrorBody(response.error);
  const validationErrors: readonly FineractValidationError[] = body?.errors ?? [];
  const candidates: readonly string[] = [
    ...validationErrors.map((failure) => failure.defaultUserMessage),
    body?.defaultUserMessage ?? '',
  ];
  const message = candidates.find((candidate) => candidate !== '') ?? UNMAPPED_FAILURE;

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

  // One sentence, built from the destination the caller was navigating to, so the text is identical wherever the same refusal is reported.
  return new ApiError(`The ${destination} did not open. Reload the page and try again.`, 0);
}

/** The failure a screen paints inline, or `null` when the interceptor has already reported it (AAP 0.7.4, AAP 0.14.2). */
export function screenFailure(cause: unknown): ApiError | null {
  const failure = toDisplayableFailure(cause);

  return failure.status >= 400 && failure.status < 500 ? failure : null;
}
