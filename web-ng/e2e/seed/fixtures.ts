/**
 * The parity harness's single source of truth: Fineract and front-end addresses, tenant, credentials,
 * date formatting, the run date read from Fineract, and the fixed test data of AAP 0.10.1.
 *
 * Consumers: `seed/seed.ts`, `capture/state-snapshot.ts`, the `pages/legacy` and `pages/next` page
 * objects, `fixtures/parity-fixture.ts`, `report/parity-report.ts` and every spec under `specs/`.
 * Exporting a name here is therefore a contract with those files; the names are fixed by the plan.
 *
 * Two properties hold for the module as a whole:
 *
 * - **Importing it is inert.** Reading it opens no socket, sends no request, writes no file and
 *   throws nothing, so `npx playwright test --list` exits 0 with no environment configured and no
 *   backend running (AAP 0.10.3). The address and tenant constants read the environment at import —
 *   `FINERACT_URL`, `LEGACY_URL` and `NEXT_URL` for the three addresses, `TENANT_ID` or else
 *   `FINERACT_TENANT_ID` for the tenant — but only as an override of a default, so an unset variable
 *   can pick the default and can never fail. Everything that can fail — missing credentials, an HTTP
 *   call, a payload of the wrong shape — lives inside a function body and fails at call time.
 * - **The run date is Fineract's.** Every date a workflow seeds, submits or compares derives from
 *   `readBusinessDate()`, the tenant's business date read over the API, never from the browser
 *   clock (Rule 1 clause 2; AAP 0.10.1, "Run date").
 *
 * It imports `request` and the `APIResponse` type from the already-pinned `@playwright/test` and
 * nothing else: no new dependency, no application model from `web-ng/src`, and no Node builtin
 * (Rule 1 clauses 4 and 7).
 */

import { request } from '@playwright/test';
import type { APIResponse } from '@playwright/test';

/**
 * Reads the first non-blank value among a setting's accepted variable names, falling back when none
 * of them is set to one. Internal to this module: the one reader behind every environment setting,
 * so a setting with an accepted alias resolves by the same precedence as a setting without.
 *
 * @param envNames Accepted variable names, in the order they are read.
 * @param fallback Value used when none of the names is set to a non-blank value.
 */
function resolveFirstNonBlank(envNames: readonly string[], fallback: string): string {
  for (const envName of envNames) {
    const configured = (process.env[envName] ?? '').trim();
    if (configured.length > 0) {
      return configured;
    }
  }
  return fallback;
}

/**
 * Reads an environment setting that has one accepted name, falling back when it is unset or blank.
 * Internal to this module.
 */
function resolveSetting(envName: string, fallback: string): string {
  return resolveFirstNonBlank([envName], fallback);
}

/**
 * Reads a base address from the environment and drops trailing slashes, so path composition can
 * never produce a doubled slash. Internal to this module.
 */
function resolveBaseUrl(envName: string, fallback: string): string {
  return resolveSetting(envName, fallback).replace(/\/+$/, '');
}

/**
 * Base address of the Fineract backend, without the API path: `FINERACT_URL`, or the locally built
 * Fineract on `https://localhost:8443` (Rule 2 — the only permitted backend). The default matches
 * the one `web-ng/e2e/playwright.config.ts` and `web-ng/src/assets/config.json` declare, so the
 * three files cannot disagree.
 */
export const FINERACT_URL: string = resolveBaseUrl('FINERACT_URL', 'https://localhost:8443');

/**
 * Base address of the legacy AngularJS application — the parity baseline, read-only and untouched
 * (Rule 1 clause 1). Defaults to the port its own container serves on.
 */
export const LEGACY_URL: string = resolveBaseUrl('LEGACY_URL', 'http://localhost:9090');

/** Base address of the new Angular application under test. Defaults to the port its image serves on. */
export const NEXT_URL: string = resolveBaseUrl('NEXT_URL', 'http://localhost:4300');

/** The API version segment every Fineract resource path sits below (`apiVer` in the legacy app). */
export const API_PATH = '/fineract-provider/api/v1';

/**
 * Fineract tenant the harness runs as: the first non-blank of `TENANT_ID` then
 * `FINERACT_TENANT_ID` — the spelling the host this suite runs on exports, as it exports the
 * `FINERACT_USERNAME`/`FINERACT_PASSWORD` pair — or the default tenant `default` when neither is
 * set. The seed, the page objects' entry URLs and every request's tenant header carry the answer.
 */
export const TENANT_ID: string = resolveFirstNonBlank(
  ['TENANT_ID', 'FINERACT_TENANT_ID'],
  'default',
);

/**
 * Name of the tenant header the API contract fixes, and the one both front ends send. `apiHeaders()`
 * attaches it; the capture side reads it to prove the tenant of every recorded request.
 */
export const TENANT_HEADER = 'Fineract-Platform-TenantId';

/**
 * Date format every date-bearing payload carries — the same constant
 * `web-ng/src/assets/config.json` ships (Rule 1 clause 2).
 */
export const PAYLOAD_DATE_FORMAT = 'dd MMMM yyyy';

/** Language every date-bearing payload is interpreted in, matching `config.json`. */
export const LOCALE = 'en';

/**
 * Composes the absolute URL of one Fineract resource. The only place the harness builds such a URL,
 * so a path can never be double-prefixed and an endpoint can never be assembled by accident.
 *
 * @param path Resource path below {@link API_PATH}, starting with `/` — e.g. `/clients/2`.
 * @returns `FINERACT_URL` + {@link API_PATH} + `path`.
 * @throws When `path` is empty, is an absolute URL, does not start with `/`, or already contains
 * {@link API_PATH}. A caller that passes any of those has a bug, and failing loudly here is what
 * keeps the harness from quietly calling a different address than the application does.
 */
export function apiUrl(path: string): string {
  if (path.length === 0) {
    throw new Error(`apiUrl() needs a resource path below ${API_PATH}, for example "/clients".`);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error(`apiUrl() takes a path below ${API_PATH}, not an absolute URL: ${path}`);
  }
  if (!path.startsWith('/')) {
    throw new Error(`apiUrl() needs a path that starts with "/": ${path}`);
  }
  if (path.includes(API_PATH)) {
    throw new Error(`apiUrl() adds ${API_PATH} itself, so the path must not contain it: ${path}`);
  }
  return `${FINERACT_URL}${API_PATH}${path}`;
}

/**
 * Reads the first non-blank value among one credential's accepted variables, or `''` when none of
 * them is set. Internal to this module: {@link readCredentials} reports an absent value itself, so
 * this reader answers with `''` rather than with a default.
 *
 * @param envNames Accepted variable names, in the order they are read.
 */
function resolveCredential(envNames: readonly string[]): string {
  return resolveFirstNonBlank(envNames, '');
}

/** The Fineract credential pair the harness authenticates with. */
export interface Credentials {
  /** Fineract user name, read from `E2E_USER` or else `FINERACT_USERNAME` at call time. */
  readonly username: string;
  /**
   * Fineract password, read from `E2E_PASSWORD` or else `FINERACT_PASSWORD` at call time; never
   * logged, serialised or written.
   */
  readonly password: string;
}

/**
 * Reads the harness credentials from the environment. Consumed by {@link authenticate}; the page
 * objects and specs never need them directly.
 *
 * Each value comes from the first of its accepted names that is set and non-blank: the user name
 * from `E2E_USER` then `FINERACT_USERNAME`, the password from `E2E_PASSWORD` then
 * `FINERACT_PASSWORD`. `E2E_USER`/`E2E_PASSWORD` are the names AAP 0.13 fixes and stay first; the
 * `FINERACT_*` pair follows because it is the spelling the host this harness runs on exports, so
 * the run authenticates there without the operator inventing an alias.
 *
 * The variables are read inside this body, never at import, so an unconfigured environment breaks
 * the check that needs credentials and leaves the rest of the run — collection, date helpers,
 * fixture data — working. A blank value counts as unset, there is no default value of any kind
 * (Rule 1 clause 9), and the pair is returned in memory only.
 *
 * @throws When neither name of the user name nor of the password yields a value; the message names
 * every accepted variable, states which value is missing and points at `web-ng/README.md`, the only
 * place the harness's environment is documented. It never echoes a value.
 */
export function readCredentials(): Credentials {
  const username = resolveCredential(['E2E_USER', 'FINERACT_USERNAME']);
  const password = resolveCredential(['E2E_PASSWORD', 'FINERACT_PASSWORD']);
  const missing: string[] = [];
  if (username.length === 0) {
    missing.push('no user name in E2E_USER or FINERACT_USERNAME');
  }
  if (password.length === 0) {
    missing.push('no password in E2E_PASSWORD or FINERACT_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing Fineract credentials for the parity harness: ${missing.join(', and ')}. ` +
        'The user name is read from E2E_USER or FINERACT_USERNAME and the password from ' +
        'E2E_PASSWORD or FINERACT_PASSWORD; export the missing value before running the harness. ' +
        'web-ng/README.md names every variable the harness reads and where the development ' +
        'credentials come from.',
    );
  }
  return { username, password };
}

/** Narrows a JSON object payload; `Array.isArray` alone would leave the elements loosely typed. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Echoes a payload inside an error message without letting a stringify failure mask the real cause. */
function describeBody(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Lists a payload's top-level field names only — see {@link parseAuthenticationKey}, which must
 * never echo an authentication response's values into a message a test runner prints. */
function describeFields(value: unknown): string {
  return isRecord(value) ? Object.keys(value).sort().join(', ') || '(none)' : typeof value;
}

/**
 * Parses a response body as JSON, reporting the raw body when it is not JSON.
 *
 * @param text Raw response body.
 * @param source What was called and its status, used in the error message.
 */
function readJsonBody(text: string, source: string): unknown {
  try {
    // JSON.parse answers `any`; widening it to `unknown` here is the boundary a caller must narrow,
    // which is what keeps `any` out of this module (Rule 1 clause 4).
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source} did not answer with JSON. Observed body: ${text.slice(0, 500)}`);
  }
}

/**
 * The fields of `POST /authentication` this harness reads. The legacy authentication service returns
 * far more — permissions, 2FA flags, password-expiry flags — none of which the harness uses, so none
 * of it is modelled.
 */
export interface AuthenticationResponse {
  /** Base64 credential the session and every later request carry as `Authorization: Basic <key>`. */
  readonly base64EncodedAuthenticationKey: string;
}

/**
 * Narrows an authentication response to {@link AuthenticationResponse}. Consumed by
 * {@link authenticate} and available to the capture side, which masks the key it names.
 *
 * The body is read as `unknown` because it crosses the HTTP boundary the harness does not own; the
 * guard is the documented boundary at which that stops (Rule 1 clause 4).
 *
 * @param body Parsed response body.
 * @param source What was called and its status, used in the error message.
 * @throws When the body is not a JSON object or carries no non-empty key. The message lists the
 * response's field names but never its values, because a response that carries a key at all may
 * carry it under a shape this guard does not read (Rule 1 clause 9).
 */
export function parseAuthenticationKey(body: unknown, source = 'the authentication response'): string {
  if (isRecord(body)) {
    const key = body['base64EncodedAuthenticationKey'];
    if (typeof key === 'string' && key.length > 0) {
      return key;
    }
  }
  throw new Error(
    `${source} carried no usable base64EncodedAuthenticationKey. ` +
      `Response fields: ${describeFields(body)}`,
  );
}

/**
 * The fields of `GET /businessdate/BUSINESS_DATE` this harness reads: the business date as
 * `[year, month, day]` with a 1-based month, beside a description and a type the harness ignores.
 */
export interface BusinessDateResponse {
  /** Human-readable description of the business date, as Fineract renders it. */
  readonly description: string;
  /** Business date type the endpoint answered for, e.g. `BUSINESS_DATE`. */
  readonly type: string;
  /** The date itself: 1-based month, as Fineract sends it. */
  readonly date: readonly [number, number, number];
}

/** Reads a `[year, month, day]` triple, or `null` when the value is not one. */
function readDateParts(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  // `Array.isArray` narrows to `any[]`; this cast re-establishes `unknown` for the elements so the
  // three components are checked one by one instead of trusted (Rule 1 clause 4).
  const parts = value as readonly unknown[];
  const [year, month, day] = parts;
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    return null;
  }
  if (typeof month !== 'number' || !Number.isInteger(month)) {
    return null;
  }
  if (typeof day !== 'number' || !Number.isInteger(day)) {
    return null;
  }
  return [year, month, day];
}

/**
 * Narrows a business-date response to {@link BusinessDateResponse}. Read as `unknown` at the same
 * HTTP boundary as {@link parseAuthenticationKey} (Rule 1 clause 4).
 *
 * @param body Parsed response body.
 * @param source What was called and its status, used in the error message.
 * @throws When the body is not a JSON object or `date` is not three integers.
 */
export function parseBusinessDateResponse(
  body: unknown,
  source = 'the business-date response',
): BusinessDateResponse {
  if (!isRecord(body)) {
    throw new Error(`${source} is not a JSON object. Observed body: ${describeBody(body)}`);
  }
  const parts = readDateParts(body['date']);
  if (parts === null) {
    throw new Error(
      `${source} carried no usable date array [year, month, day]. Observed body: ${describeBody(body)}`,
    );
  }
  const description = body['description'];
  const type = body['type'];
  return {
    description: typeof description === 'string' ? description : '',
    type: typeof type === 'string' ? type : '',
    date: parts,
  };
}

/**
 * Turns a business-date response into a `Date` at UTC midnight — the run date every workflow, seed
 * value and comparison derives from (Rule 1 clause 2; AAP 0.10.1).
 *
 * UTC midnight, not local midnight, is what makes the value comparable across machines: the harness
 * runs on macOS and in Codespaces (AAP 0.10.3), and a local-midnight date would shift the run date by
 * a day in any negative-offset timezone.
 *
 * @param body Parsed response body.
 * @param source What was called and its status, used in the error message.
 * @throws When the body is not a business-date response, or when its components do not name a real
 * calendar date (`[2026, 13, 45]` and friends). The observed body is echoed: this payload carries no
 * credentials.
 */
export function parseBusinessDate(body: unknown, source = 'the business-date response'): Date {
  const response = parseBusinessDateResponse(body, source);
  const [year, month, day] = response.date;
  // Date.UTC takes a 0-based month and rolls impossible values forward, so the round trip below is
  // what rejects 2026-13-45 rather than silently answering a date in 2027.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(
      `${source} carried an impossible date ${year}-${month}-${day}. Observed body: ${describeBody(body)}`,
    );
  }
  return date;
}

/**
 * A request this module made that produced no usable answer: no HTTP response at all (the connection
 * was refused, the TLS handshake failed or the call timed out), or a response Fineract refused.
 *
 * It carries the resource path below {@link API_PATH} and the HTTP status — `0` when no response
 * arrived — which is what a caller needs to say what failed. It never carries a request header, the
 * authentication key, a password or Playwright's own failure text: Playwright reports a failed API
 * call together with the request's headers, and those headers carry the credential (Rule 1
 * clause 9). `capture/state-snapshot.ts` translates it into its own `StateSnapshotError`, so a failed
 * read of this module reaches a report or a log as a path and a status and nothing else.
 */
export class FixtureRequestError extends Error {
  /** Resource path below {@link API_PATH}, e.g. `/businessdate/BUSINESS_DATE` — a path, never a host. */
  readonly path: string;
  /** HTTP status Fineract answered with, or `0` when no response arrived at all. */
  readonly status: number;

  constructor(path: string, status: number, message: string) {
    super(message);
    this.name = 'FixtureRequestError';
    this.path = path;
    this.status = status;
  }
}

/** Resource path of the credential exchange, `POST /authentication` — workflow W1's first call. */
const AUTHENTICATION_PATH = '/authentication';

/** Resource path of the tenant business-date read, `GET /businessdate/BUSINESS_DATE` — harness-only
 * because the application reads no business date (AAP 0.9.4 row 9; AAP 0.10.4, AAP 0.10.5 item 15). */
const BUSINESS_DATE_PATH = '/businessdate/BUSINESS_DATE';

/**
 * The {@link FixtureRequestError} a transport-level failure raises: no HTTP response arrived, so the
 * status is `0`.
 *
 * The caught error is deliberately neither echoed nor chained as `cause`: Playwright reports a failed
 * API call together with the request's headers, which carry the credential (Rule 1 clause 9). Only the
 * method, the resource path and the URL reach the message, and none of the three holds a credential.
 *
 * @param method HTTP method of the call that failed.
 * @param path Resource path below {@link API_PATH} the call addressed.
 * @param url Absolute URL the call addressed.
 */
function transportFailure(method: 'GET' | 'POST', path: string, url: string): FixtureRequestError {
  return new FixtureRequestError(
    path,
    0,
    `${method} ${url} produced no HTTP response: the connection was refused, the TLS handshake ` +
      'failed or the call timed out.',
  );
}

/**
 * The headers every Fineract request carries: the basic-auth credential, the tenant, and JSON in
 * both directions (AAP 0.7.3, "Authentication and headers"). Consumed by {@link readBusinessDate},
 * the seed script, the state snapshot and every page object's API assertions.
 *
 * @param authenticationKey Key returned by {@link authenticate}.
 */
export function apiHeaders(authenticationKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${authenticationKey}`,
    [TENANT_HEADER]: TENANT_ID,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Authenticates against Fineract — `POST /authentication`, workflow W1's first call — and returns
 * the basic-auth credential every later request needs. Consumed by {@link readBusinessDate}, the
 * seed script and the state snapshot.
 *
 * The credential lives in memory only: it is never logged, cached to disk or serialised, and the
 * caller hands it straight to {@link apiHeaders} (Rule 1 clause 9; masking recorded traffic is the
 * capture side's job). The request context accepts the backend's self-signed certificate, which is
 * the reason Playwright's API request context is used rather than a bare `fetch`.
 *
 * @throws {@link FixtureRequestError} when the call produces no HTTP response at all, or when
 * Fineract refuses it: the error then carries the resource path and the status, and a transport
 * failure names the endpoint only. `Error` when credentials are missing ({@link readCredentials}) or
 * when the answer carries no key. Playwright's own failure text is never echoed, because it quotes
 * the request headers (Rule 1 clause 9).
 */
export async function authenticate(): Promise<string> {
  const credentials = readCredentials();
  const url = apiUrl(AUTHENTICATION_PATH);
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    let response: APIResponse;
    try {
      response = await context.post<unknown>(url, {
        data: { username: credentials.username, password: credentials.password },
        headers: {
          [TENANT_HEADER]: TENANT_ID,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
    } catch {
      throw transportFailure('POST', AUTHENTICATION_PATH, url);
    }
    const status = response.status();
    const text = await response.text();
    if (!response.ok()) {
      throw new FixtureRequestError(
        AUTHENTICATION_PATH,
        status,
        `POST ${url} failed with HTTP ${status}. Fineract answered: ${text.slice(0, 500)}`,
      );
    }
    const source = `POST ${url} (HTTP ${status})`;
    return parseAuthenticationKey(readJsonBody(text, source), source);
  } finally {
    await context.dispose();
  }
}

/** Milliseconds in a whole day; the unit {@link addDays} and {@link dayOffset} work in. */
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The run date once a read has succeeded, `null` until then and after a reset. Per process, because
 * one UI's run must use one run date for every workflow, seed value and comparison it makes.
 */
let cachedBusinessDate: Date | null = null;

/**
 * Discards the cached run date so the next {@link readBusinessDate} reads it from Fineract again.
 * `npm run e2e` runs the legacy project and then the next project in one command (AAP 0.10.4), and
 * the parity fixture calls this between them so a business date that rolled over mid-run is picked up
 * rather than dated from the previous UI's run.
 */
export function resetBusinessDateCache(): void {
  cachedBusinessDate = null;
}

/**
 * The run date: the tenant's business date, read from Fineract over the API — the one source every
 * workflow input, seed value and comparison in the harness derives its dates from (Rule 1 clause 2;
 * AAP 0.10.1, "Run date"). Consumed by the seed script, the page objects, the state snapshot and the
 * parity report.
 *
 * `GET /fineract-provider/api/v1/businessdate/BUSINESS_DATE` is harness-only and belongs in
 * `web-ng/tools/parity/harness-allowlist.json` (candidate recorded in AAP 0.9.4 row 9; AAP 0.10.4),
 * never in the application's allowlist, because the application itself reads no business date
 * (AAP 0.10.5 item 15).
 *
 * The successful value is cached for the life of the process; callers get a copy, so mutating the
 * returned `Date` cannot corrupt the cache. The cache is consulted before the key, so a cached run
 * date answers a call made with or without one and no request is sent either way. A failed read
 * leaves the cache empty, so the next call retries instead of serving a stale run date.
 *
 * @param authenticationKey Key an earlier {@link authenticate} call already returned, when the caller
 * holds one. A non-empty key is reused as it stands, so a caller that has authenticated passes it in
 * rather than paying for a second `POST /authentication`; that also keeps the run's only key the one
 * the caller registered for masking (Rule 1 clause 9). Omitted or empty, this function authenticates
 * for itself, which is what a caller holding no key relies on.
 * @throws {@link FixtureRequestError} when the call produces no HTTP response at all, or when
 * Fineract refuses it or answers non-2xx: the error carries the resource path and the status, and a
 * transport failure names the endpoint only, never the request headers Playwright would quote
 * (Rule 1 clause 9). `Error` when credentials are missing or the payload is not the documented
 * `{description, type, date: [year, month, day]}`. It never falls back to the browser clock: a
 * harness that invented a run date would date every workflow from the wrong day, which is exactly
 * what Rule 1 clause 2 forbids.
 */
export async function readBusinessDate(authenticationKey?: string): Promise<Date> {
  if (cachedBusinessDate !== null) {
    return new Date(cachedBusinessDate.getTime());
  }
  // Authenticating only when the caller handed over no key keeps one run to a single
  // POST /authentication, and keeps the key sent from here the one the caller registered for masking.
  const key =
    authenticationKey === undefined || authenticationKey.length === 0
      ? await authenticate()
      : authenticationKey;
  const url = apiUrl(BUSINESS_DATE_PATH);
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    let response: APIResponse;
    try {
      response = await context.get<unknown>(url, { headers: apiHeaders(key) });
    } catch {
      throw transportFailure('GET', BUSINESS_DATE_PATH, url);
    }
    const status = response.status();
    const text = await response.text();
    if (!response.ok()) {
      throw new FixtureRequestError(
        BUSINESS_DATE_PATH,
        status,
        `GET ${url} failed with HTTP ${status}. Fineract answered: ${text.slice(0, 500)}`,
      );
    }
    const source = `GET ${url} (HTTP ${status})`;
    const businessDate = parseBusinessDate(readJsonBody(text, source), source);
    cachedBusinessDate = businessDate;
    return new Date(businessDate.getTime());
  } finally {
    await context.dispose();
  }
}

/** A date as a Fineract payload carries it: the text, the format that produced the text, and the
 * language the server must read it in (Rule 1 clause 2). */
export interface FineractDatePayload {
  /** The day, zero-padded, e.g. `21 November 2026`. */
  readonly date: string;
  /** The format the text follows — always {@link PAYLOAD_DATE_FORMAT}. */
  readonly dateFormat: string;
  /** The language the text must be read in — always {@link LOCALE}. */
  readonly locale: string;
}

/** Full English month names in calendar order. A fixed table rather than `Intl`, so the text cannot
 * vary with the host's locale data — the harness must behave identically on macOS and in Codespaces
 * (AAP 0.10.3). */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Formats a date the way every date-bearing Fineract payload carries it, so a payload spreads this
 * object instead of assembling a string by hand (Rule 1 clause 2). Consumed by the seed script, the
 * page objects and every spec that submits or asserts a date.
 *
 * The components are read in UTC on purpose: a UTC-midnight `Date` read with local getters shifts a
 * day in any negative-offset timezone, and the same file has to answer the same text on both
 * verification platforms (AAP 0.10.3).
 *
 * @param date Date to format; its time of day is ignored.
 * @throws When `date` is not a valid `Date`.
 */
export function formatFineractDate(date: Date): FineractDatePayload {
  const monthName = MONTH_NAMES[date.getUTCMonth()];
  if (Number.isNaN(date.getTime()) || monthName === undefined) {
    throw new Error(`formatFineractDate() needs a valid Date; received ${String(date)}`);
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return { date: `${day} ${monthName} ${year}`, dateFormat: PAYLOAD_DATE_FORMAT, locale: LOCALE };
}

/** Milliseconds of a date's UTC midnight, rejecting an invalid date rather than computing `NaN`. */
function utcMidnight(date: Date, caller: string): number {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${caller}() needs a valid Date; received ${String(date)}`);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * A new `Date` at UTC midnight, `n` days after `date`. Consumed by the fixtures that derive their
 * dates from the run date instead of hard-coding one (AAP 0.10.1).
 *
 * The argument is never mutated, and its time of day is discarded: every date the harness compares
 * is a whole day, so carrying a clock time into a comparison would only manufacture differences.
 *
 * @param date Date to shift; not modified.
 * @param n Whole days to add; negative values shift backwards.
 * @throws When `date` is not a valid `Date` or `n` is not an integer.
 */
export function addDays(date: Date, n: number): Date {
  const midnight = utcMidnight(date, 'addDays');
  if (!Number.isInteger(n)) {
    throw new Error(`addDays() needs a whole number of days; received ${String(n)}`);
  }
  return new Date(midnight + n * MILLISECONDS_PER_DAY);
}

/**
 * The whole-day distance from `from` to `to`, positive when `to` is later. AAP 0.10.2 compares dates
 * as day offsets from the run date rather than as literal strings, so a comparison survives a run
 * that happens on a different day; the parity report and the page objects use this for that reason.
 *
 * @param from Origin date; only its UTC calendar day is used.
 * @param to Target date, or epoch milliseconds when a caller compares against a raw timestamp.
 * @returns The difference rounded to whole days.
 * @throws When `from` is not a valid `Date`, or `to` is a `Date` that is not one or a number that is
 * not finite.
 */
export function dayOffset(from: Date, to: number | Date): number {
  const start = utcMidnight(from, 'dayOffset');
  const end = typeof to === 'number' ? to : utcMidnight(to, 'dayOffset');
  if (!Number.isFinite(end)) {
    throw new Error(`dayOffset() needs a finite target; received ${String(to)}`);
  }
  return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

/** The payload text form a date-bearing Fineract field carries (Rule 1 clause 2): a 1- or 2-digit day,
 * a full English month name and a 4-digit year, e.g. `21 November 2026`. */
const PAYLOAD_DATE_TEXT_PATTERN = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/;

/** The ISO date-only form some Fineract resources answer with, e.g. `2026-11-21`. */
const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `Date` at UTC midnight for a 1-based-month calendar date, or `null` when those components are not
 * a real day — `31 February`, or month `13`. The round trip below is what rejects them: `Date.UTC`
 * would otherwise roll an impossible day forward into the following month.
 */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}

/**
 * A date as Fineract reports one, or `null` for any other shape. Three shapes are read, because the
 * resources the harness calls are not consistent about which one they send and one comparison has to
 * understand all of them (AAP 0.10.2, "Dates"):
 *
 * - `[year, month, day]` with a 1-based month — what `GET /clients/{id}` and the business-date
 *   endpoint answer with, and the shape {@link readDateParts} and {@link parseBusinessDate} read.
 * - `dd MMMM yyyy` — the form every date-bearing payload sends (Rule 1 clause 2), with a 1- or
 *   2-digit day and a case-insensitive full month name from {@link MONTH_NAMES}.
 * - `yyyy-mm-dd` — the ISO form other Fineract resources answer with.
 *
 * `null` rather than a guess for everything else, and for an impossible calendar day (`31 February`,
 * month `13`): AAP 0.10.2 compares every run-date-derived value as a day offset, and an offset
 * computed from a misread date would surface as a behavioural difference between the two front ends
 * that neither of them caused. Every component is read in UTC and nothing here depends on `Intl`, so
 * the same payload answers the same day on macOS and in Codespaces (AAP 0.10.3).
 *
 * @param value Any JSON value a payload can carry under a date-named key.
 * @returns The day at UTC midnight, or `null` when the value is not a date this harness reads.
 */
export function parseFineractDate(value: unknown): Date | null {
  const parts = readDateParts(value);
  if (parts !== null) {
    return calendarDate(parts[0], parts[1], parts[2]);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  const payloadForm = PAYLOAD_DATE_TEXT_PATTERN.exec(text);
  if (payloadForm !== null) {
    const monthName = payloadForm[2].toLowerCase();
    const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === monthName) + 1;
    return month === 0 ? null : calendarDate(Number(payloadForm[3]), month, Number(payloadForm[1]));
  }
  const isoForm = ISO_DATE_ONLY_PATTERN.exec(text);
  if (isoForm !== null) {
    return calendarDate(Number(isoForm[1]), Number(isoForm[2]), Number(isoForm[3]));
  }
  return null;
}

/**
 * A date as `yyyy-mm-dd` in UTC: the run-date metadata form both capture writers record, so a
 * written capture names the day its offsets are measured from (AAP 0.10.2, determinism). UTC and zero
 * padding together make that text a calendar day that compares as text — never a clock time and never
 * a host-specific rendering (AAP 0.10.3).
 *
 * @param date Date to render; its time of day is ignored.
 * @throws When `date` is not a valid `Date`.
 */
export function formatDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateOnly() needs a valid Date; received ${String(date)}`);
  }
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${month}-${day}`;
}

/**
 * The staff member the seed creates — the AAP 0.10.1 row "Staff: Parity Officer, loan officer,
 * office 1 (Head Office)".
 *
 * The table gives one two-word value, and Fineract's staff record keeps a first and a last name, so
 * the pair below is that value split at its space — `Parity`, then `Officer` — rather than either
 * name invented. The name the screens show is not the table's label but the one Fineract composes
 * from the pair, last name first; see {@link StaffSeed.displayName}.
 */
export interface StaffSeed {
  /** Given name Fineract stores for the staff member. */
  readonly firstname: string;
  /** Family name Fineract stores for the staff member. */
  readonly lastname: string;
  /**
   * Name the client and loan screens display. Fineract composes it from the two names above — the
   * last name, a comma and a space, then the first name (`StaffWriteServiceImpl.createStaff`) — and
   * stores it as the staff member's display name, so this seed's is `Officer, Parity`, not the AAP
   * table's `Parity Officer`. The staff dropdowns label their options with it, which makes it the
   * value a loan officer is chosen by.
   */
  readonly displayName: string;
  /** Office the staff member belongs to: office 1, Head Office. */
  readonly officeId: number;
  /** Name of that office, as Fineract returns it. */
  readonly officeName: string;
  /** Whether the staff member can be selected as a loan officer, which the plan's workflows require. */
  readonly isLoanOfficer: boolean;
}

/** The seed staff member of AAP 0.10.1, consumed by `seed/seed.ts` and by the loan page objects,
 * which select its `displayName` as the loan officer. */
export const SEED_STAFF = {
  firstname: 'Parity',
  lastname: 'Officer',
  displayName: 'Officer, Parity',
  officeId: 1,
  officeName: 'Head Office',
  isLoanOfficer: true,
} as const satisfies StaffSeed;

/**
 * The loan product the seed creates — the AAP 0.10.1 row "Parity Loan, currency USD, principal min
 * 1,000, default 5,000, max 10,000, 12 monthly repayments, flat interest 12% per year", in the
 * table's own vocabulary.
 *
 * The Fineract enum ids these words map to (`interestType`, `amortizationType`,
 * `interestCalculationPeriodType`, `repaymentFrequencyType`, `daysInYearType`, ...) belong to
 * `seed/seed.ts`, which owns the request bodies: this module holds the fixed values, not the mapping.
 */
export interface LoanProductSeed {
  /** Product name the loan workflows select. */
  readonly name: string;
  /** Product currency. */
  readonly currencyCode: string;
  /** Lowest principal the product accepts; W7 relies on it as the lower bound of the valid range. */
  readonly minPrincipal: number;
  /** Principal the product defaults to, and the amount W4 applies for. */
  readonly principal: number;
  /** Highest principal the product accepts; W7 submits above it to provoke the server's rejection. */
  readonly maxPrincipal: number;
  /** Number of repayments in the product's default schedule. */
  readonly numberOfRepayments: number;
  /** Months between repayments. */
  readonly repaymentEveryMonths: number;
  /** Interest calculation the product uses. */
  readonly interest: 'flat';
  /** Nominal annual interest rate, in per cent. */
  readonly interestRatePerYear: number;
}

/** The seed loan product of AAP 0.10.1, consumed by the seed script, the loan page objects and W4,
 * W5, W6 and W7. */
export const SEED_LOAN_PRODUCT = {
  name: 'Parity Loan',
  currencyCode: 'USD',
  minPrincipal: 1000,
  principal: 5000,
  maxPrincipal: 10000,
  numberOfRepayments: 12,
  repaymentEveryMonths: 1,
  interest: 'flat',
  interestRatePerYear: 12,
} as const satisfies LoanProductSeed;

/**
 * The loan charge the seed creates — the AAP 0.10.1 row "Parity Fee, flat amount 25, specified due
 * date", in the table's own vocabulary. As with {@link LoanProductSeed}, the Fineract enum ids these
 * words map to belong to `seed/seed.ts`.
 */
export interface LoanChargeSeed {
  /** Charge name shown on the loan's charge list. */
  readonly name: string;
  /** Charge amount, in the product currency. */
  readonly amount: number;
  /** Currency the amount is denominated in. */
  readonly currencyCode: string;
  /** What the charge applies to. */
  readonly appliesTo: 'loan';
  /** When the charge falls due: on a date the application specifies. */
  readonly timeType: 'specified due date';
  /** How the amount is calculated. */
  readonly calculation: 'flat';
}

/** The seed loan charge of AAP 0.10.1, consumed by the seed script and by the loan charge specs. */
export const SEED_LOAN_CHARGE = {
  name: 'Parity Fee',
  amount: 25,
  currencyCode: 'USD',
  appliesTo: 'loan',
  timeType: 'specified due date',
  calculation: 'flat',
} as const satisfies LoanChargeSeed;

/**
 * The savings product the seed creates — the AAP 0.10.1 row "Parity Savings, currency USD, nominal
 * annual interest 2%", in the table's own vocabulary.
 */
export interface SavingsProductSeed {
  /** Product name the savings workflow selects. */
  readonly name: string;
  /** Product currency. */
  readonly currencyCode: string;
  /** Nominal annual interest rate, in per cent. */
  readonly nominalAnnualInterestRate: number;
}

/** The seed savings product of AAP 0.10.1, consumed by the seed script and by W8. */
export const SEED_SAVINGS_PRODUCT = {
  name: 'Parity Savings',
  currencyCode: 'USD',
  nominalAnnualInterestRate: 2,
} as const satisfies SavingsProductSeed;

/** The client W2 creates and W3 reads back. */
export interface ScenarioClient {
  /** Given name typed into the create form. */
  readonly firstname: string;
  /** Family name typed into the create form. */
  readonly lastname: string;
  /**
   * Name the client list and record display. Fineract composes it from the two names above under its
   * default name format; W3 verifies the displayed name against the API's answer rather than trusting
   * this constant.
   */
  readonly displayName: string;
  /** Office the client is created in: office 1, Head Office. */
  readonly officeId: number;
  /** Name of that office, as the record header displays it. */
  readonly officeName: string;
}

/** The loan application W4 submits. */
export interface ScenarioLoanApplication {
  /** Product the application selects. */
  readonly productName: string;
  /** Principal the application applies for. */
  readonly principal: number;
}

/** The savings account W8 opens, funds and draws on. */
export interface ScenarioSavings {
  /** Product the application selects. */
  readonly productName: string;
  /** Amount deposited after activation. */
  readonly deposit: number;
  /** Amount withdrawn after the deposit. */
  readonly withdrawal: number;
  /**
   * Balance left afterwards — the AAP 0.10.1 row's own arithmetic (1,000 - 200), which is also the
   * W8 outcome the state snapshot asserts.
   */
  readonly expectedBalance: number;
}

/**
 * How W6 derives its repayment rather than being handed a number. The AAP 0.10.1 row defines the
 * repayment as "the first period's total due from the loan's repayment schedule" — a value that only
 * exists once the loan has been disbursed, so a fabricated amount here would break W6 and the
 * W2-to-W6 chain. The spec reads it from the loan and this rule states where from.
 */
export interface ScenarioRepayment {
  /** Where the repayment amount comes from: the first repayment schedule period's total due. */
  readonly amountSource: 'first-schedule-period-total-due';
  /** Where the repayment's transaction date comes from: the loan's disbursement date. */
  readonly transactionDateSource: 'disbursement-date';
}

/**
 * The fixed test data of AAP 0.10.1, as the workflows that consume it read it. Consumed by the seed
 * script, the page objects, the state snapshot and the specs for W2, W3, W4, W7 and W8.
 *
 * Only what the table names is here (Rule 1 clause 3): no extra fixture, no extra field, and no
 * rounded or renamed value.
 */
export interface Scenario {
  /** The client W2 creates and activates, and W3 and W4 start from. */
  readonly client: ScenarioClient;
  /** The valid application W4 submits: 5,000 on the Parity Loan product. */
  readonly loanApplication: ScenarioLoanApplication;
  /**
   * The application W7 submits to provoke a server-side validation error: 50,000, above the
   * product's 10,000 maximum. It is typed into the new app rather than seeded, and it lives here so
   * the seed's product range and the spec's input cannot drift apart.
   */
  readonly invalidLoanApplication: ScenarioLoanApplication;
  /** The savings account W8 opens, funds and draws on. */
  readonly savings: ScenarioSavings;
  /** How W6 derives its repayment amount and date. */
  readonly repayment: ScenarioRepayment;
}

/** The fixed parity data of AAP 0.10.1, consumed by the seed script, the page objects, the state
 * snapshot and the specs. */
export const SCENARIO = {
  client: {
    firstname: 'Parity',
    lastname: 'Client',
    displayName: 'Parity Client',
    officeId: 1,
    officeName: 'Head Office',
  },
  loanApplication: { productName: 'Parity Loan', principal: 5000 },
  invalidLoanApplication: { productName: 'Parity Loan', principal: 50000 },
  savings: {
    productName: 'Parity Savings',
    deposit: 1000,
    withdrawal: 200,
    expectedBalance: 800,
  },
  repayment: {
    amountSource: 'first-schedule-period-total-due',
    transactionDateSource: 'disbursement-date',
  },
} as const satisfies Scenario;
