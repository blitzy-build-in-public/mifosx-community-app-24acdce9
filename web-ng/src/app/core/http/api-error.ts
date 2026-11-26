import { HttpErrorResponse } from '@angular/common/http';

/**
 * The single typed error shape for Fineract failures, and the mapper that builds it from an
 * Angular `HttpErrorResponse` (AAP 0.7.1 row "`ApiError` + mapper"; AAP 0.7.2 row `FineractError`).
 *
 * `toApiError` chooses the message in this order and stops at the first non-empty string: the first
 * `errors[].defaultUserMessage` carrying text; the body's own top-level `defaultUserMessage`; then
 * the module's fixed {@link UNMAPPED_FAILURE} sentence.
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
 * Fineract's error envelope as modelled for the in-scope screens, under the name AAP 0.7.2's model
 * table gives it (row `FineractError`). Every field is optional: a validation failure returns this
 * body, while a platform-level failure (an unmapped path, an authentication refusal, a transport
 * fault) returns a body of another shape or none, and the later fallbacks in `toApiError` carry the
 * message.
 *
 * `defaultUserMessage` is optional rather than the required member that same row shows, and for the
 * same reason: requiring it would make the reader discard a body carrying only `errors`, and with
 * it the field-level message workflow W7 depends on.
 */
export interface FineractError {
  /**
   * The envelope's own text, as the server sent it; the message used when no `errors` entry
   * carries text. Fineract sends a generic sentence here ("Validation errors exist.") beside the
   * actionable field-level entries of a validation refusal, so this member is the second choice,
   * not the first.
   */
  readonly defaultUserMessage?: string;

  /**
   * Translation key the envelope's declared shape carries for the whole failure (AAP 0.7.2 row
   * `FineractError`), deliberately not carried by `readFineractErrorBody`: every in-scope screen
   * renders Fineract's own already-localised `defaultUserMessage` verbatim (AAP 0.7.2 "Rendered
   * verbatim"; Rule 1 clause 3), so no code path in this application resolves a translation key,
   * and reading it would only create data that nothing here, and nothing outside this module,
   * could observe.
   */
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
 *
 * Of the envelope's members it carries exactly two, `defaultUserMessage` and `errors`, and it
 * deliberately leaves `userMessageGlobalisationCode` unread: every in-scope screen renders
 * Fineract's own already-localised `defaultUserMessage` verbatim (AAP 0.7.2 "Rendered verbatim";
 * Rule 1 clause 3), so no code path in this application resolves a translation key.
 */
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

/**
 * The text a failure becomes when no server message reached it.
 *
 * Every Fineract answer arrives as an `ApiError` whose `message` is the server's own text, rendered
 * verbatim (AAP 0.7.2). A body that carries none, and a rejection of another shape, have no server
 * text to show; this fixed sentence keeps a screen from rendering nothing at all, and it is
 * deliberately not translated, because no language bundle carries wording for a fault the server
 * never reported.
 */
const UNMAPPED_FAILURE = 'The request could not be completed.';

/**
 * Builds the displayable error from a failed response, choosing its message in this order and
 * returning the first non-empty string unchanged: the first `errors[].defaultUserMessage` carrying
 * text, in the server's order; the body's own top-level `defaultUserMessage`; then
 * {@link UNMAPPED_FAILURE}. A blank entry counts as absent, an absent or malformed member of the
 * body is passed over rather than costing the body its other members, and nothing else about the
 * chosen string is altered, so the text a screen shows is the text the server sent (workflow W7).
 *
 * The field-level entry comes first because AAP 0.4.4 decision 6 requires it to reach the user
 * verbatim, while Fineract sends a generic envelope sentence beside the actionable per-field ones.
 * Nothing the response carries outside those two members becomes the message — not Angular's own
 * `message`, which names the API host and the resource path, and not its URL or headers — so a
 * body carrying no server text shows this module's own sentence rather than framework phrasing
 * (Rule 1 clause 3).
 *
 * @param response The failed response Angular produced.
 * @returns The one error type a service returns, carrying the status and the field-level failures.
 */
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

/**
 * Reads whatever a rejected request produced into the one error type a screen renders.
 *
 * An `ApiError` is returned untouched, so its message, status and field-level failures stay exactly
 * what `toApiError` built from the Fineract body (Rule 1 clause 3: the server's text verbatim). An
 * `HttpErrorResponse` that reached a screen without the interceptor is mapped through `toApiError`
 * for the same reason, and an `Error` carrying a non-empty message keeps that message. Anything
 * else becomes {@link UNMAPPED_FAILURE}. Every failure that is not already an `ApiError` carries
 * status `0`, the class's marker for "no HTTP answer". Nothing is logged, no header, request or
 * body is read, and no credential-shaped string can reach a screen through it (Rule 1 clause 9).
 *
 * @param cause Whatever the rejected request delivered.
 * @returns The failure to render.
 */
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

/**
 * Reads a refused navigation into the one error type a screen renders.
 *
 * `router.navigate()` rejects when the router refuses the navigation — a guard that answered false,
 * a `NavigationCancelled`, a `NavigationError`, or a rejection carrying nothing at all. That is not
 * an HTTP answer and it names no destination, so it is not mapped through
 * {@link toDisplayableFailure}: that mapper keeps any non-empty `Error.message`, which for a router
 * refusal is Angular's own sentence about navigation ids and guards, and its fallback is
 * {@link UNMAPPED_FAILURE} — a request sentence for a failure that made no request. Either way the
 * user would be shown text that says nothing about where they were going and leaves them nothing to
 * do, so a refusal of another shape becomes one fixed sentence naming the screen they were heading
 * for. That sentence is deliberately not translated, for the reason {@link UNMAPPED_FAILURE} is not:
 * no language bundle carries wording for a fault the server never reported.
 *
 * The two shapes that do carry the server's own text keep it. An `ApiError` is returned untouched
 * and an `HttpErrorResponse` is mapped through `toApiError`, because a route guard whose own read
 * failed refuses the navigation with Fineract's answer, and that `defaultUserMessage` must reach the
 * user verbatim (AAP 0.4.4 decision 6; Rule 1 clause 3) rather than be replaced by this sentence.
 *
 * @param cause Whatever the refused navigation rejected with.
 * @param destination The screen the user was heading for, phrased to follow "The" and precede "did
 *   not open", as in `'login screen'`.
 * @returns The failure to render.
 */
export function navigationFailure(cause: unknown, destination: string): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }

  if (cause instanceof HttpErrorResponse) {
    return toApiError(cause);
  }

  // One sentence, built from the destination the caller was navigating to, so the text is identical
  // wherever the same refusal is reported.
  return new ApiError(`The ${destination} did not open. Reload the page and try again.`, 0);
}

/**
 * The failure a screen paints inline, or `null` when the interceptor has already reported it.
 *
 * A 4xx is Fineract's answer to the values a form submitted, and every screen renders that message
 * verbatim above the form (AAP 0.7.4). A status of `0` or one at or above `500` has already had
 * exactly one notification raised for it in `fineract.interceptor.ts` (AAP 0.7.4; AAP 0.14.2 "every
 * HTTP call path ends in either a rendered message or a notification"), so a screen that painted it
 * again would report one failure twice. A `404` is a client failure and is answered here like any
 * other 4xx, so a screen that owns a not-found state checks the failure's status for `404` before
 * calling this, and paints its own not-found message instead.
 *
 * @param cause Whatever the rejected request delivered.
 * @returns The failure to render inline, or `null` when it must not be painted again.
 */
export function screenFailure(cause: unknown): ApiError | null {
  const failure = toDisplayableFailure(cause);

  return failure.status >= 400 && failure.status < 500 ? failure : null;
}
