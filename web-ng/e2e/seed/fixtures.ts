/** The parity harness's single source of truth: Fineract and front-end addresses, tenant, credentials, date formatting, the run date read from Fineract, and the fixed test data of AAP 0.10.1 — the staff member, the loan product, the loan charge and the workflow records; the savings product is withheld by the first step of AAP 0.9.3's fixed cut order — the Stretch cut — which is recorded in AAP 0.9.3, web-ng/README.md and the parity report (AAP 0.10.3, Rule 1 clauses 2 and 10). */

import { request } from '@playwright/test';
import type { APIResponse } from '@playwright/test';

function resolveFirstNonBlank(envNames: readonly string[], fallback: string): string {
  for (const envName of envNames) {
    const configured = (process.env[envName] ?? '').trim();
    if (configured.length > 0) {
      return configured;
    }
  }
  return fallback;
}
function resolveSetting(envName: string, fallback: string): string {
  return resolveFirstNonBlank([envName], fallback);
}
function resolveBaseUrl(envName: string, fallback: string): string {
  return resolveSetting(envName, fallback).replace(/\/+$/, '');
}
/** Base address of the Fineract backend without the API path: `FINERACT_URL`, or the locally built Fineract on `https://localhost:8443` (Rule 2 — the only permitted backend); the default matches `web-ng/e2e/playwright.config.ts` and `web-ng/src/assets/config.json`. */
export const FINERACT_URL: string = resolveBaseUrl('FINERACT_URL', 'https://localhost:8443');
/** Base address of the legacy AngularJS application — the parity baseline, read-only and untouched (Rule 1 clause 1); defaults to the port its own container serves on. */
export const LEGACY_URL: string = resolveBaseUrl('LEGACY_URL', 'http://localhost:9090');
export const NEXT_URL: string = resolveBaseUrl('NEXT_URL', 'http://localhost:4300');
/** The API version segment every Fineract resource path sits below (`apiVer` in the legacy app). */
export const API_PATH = '/fineract-provider/api/v1';
export const TENANT_ID: string = resolveFirstNonBlank(
  ['TENANT_ID', 'FINERACT_TENANT_ID'], 'default',
);
export const TENANT_HEADER = 'Fineract-Platform-TenantId';
/** Date format every date-bearing payload carries — the same constant `web-ng/src/assets/config.json` ships (Rule 1 clause 2). */
export const PAYLOAD_DATE_FORMAT = 'dd MMMM yyyy';
export const LOCALE = 'en';
/** Composes the absolute URL of one Fineract resource — the only place the harness builds one, so a path can never be double-prefixed and an endpoint can never be assembled by accident. @returns `FINERACT_URL` + {@link API_PATH} + `path`. @throws When `path` is empty, is an absolute URL, does not start with `/` or already contains {@link API_PATH}, which keeps the harness from quietly calling a different address than the application does. */
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
/** Reads the first non-blank value among one credential's accepted variables, or `''` when none is set: {@link readCredentials} reports an absent value itself, so this reader answers `''` rather than a default. */
function resolveCredential(envNames: readonly string[]): string {
  return resolveFirstNonBlank(envNames, '');
}
export interface Credentials {
  readonly username: string;
  readonly password: string;
}
/** Reads the harness credentials from the environment, consumed by {@link authenticate}: the user name from `E2E_USER` then `FINERACT_USERNAME`, the password from `E2E_PASSWORD` then `FINERACT_PASSWORD`, each first set one winning and a blank or absent one falling through to the next (AAP 0.13, Rule 1 clause 9). */
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function describeBody(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
function describeFields(value: unknown): string {
  return isRecord(value) ? Object.keys(value).sort().join(', ') || '(none)' : typeof value;
}
function readJsonBody(text: string, source: string): unknown {
  try {
    // JSON.parse answers `any`; widening it to `unknown` here is the boundary a caller must narrow, which is what keeps `any` out of this module (Rule 1 clause 4).
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source} did not answer with JSON. Observed body: ${text.slice(0, 500)}`);
  }
}
/** The fields of `POST /authentication` this harness reads; the legacy authentication service returns far more — permissions, 2FA and password-expiry flags — none of which the harness uses. */
export interface AuthenticationResponse {
  readonly base64EncodedAuthenticationKey: string;
}
/** Narrows an authentication response to {@link AuthenticationResponse}, consumed by {@link authenticate} and by the capture side, which masks the key it names; the body is read as `unknown` because it crosses an HTTP boundary the harness does not own, and this guard is the documented point where that stops (Rule 1 clause 4). @throws When the body is not a JSON object or carries no non-empty key — the message lists the response's field names and never its values (Rule 1 clause 9). */
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
/** The fields of `GET /businessdate/BUSINESS_DATE` this harness reads: the business date as `[year, month, day]` with a 1-based month, beside a description and a type the harness ignores. */
export interface BusinessDateResponse {
  readonly description: string;
  readonly type: string;
  readonly date: readonly [number, number, number];
}
function readDateParts(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  // `Array.isArray` narrows to `any[]`; this cast re-establishes `unknown` for the elements so the three components are checked one by one instead of trusted (Rule 1 clause 4).
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
/** Narrows a business-date response to {@link BusinessDateResponse}, read as `unknown` at the same HTTP boundary as {@link parseAuthenticationKey} (Rule 1 clause 4). @throws When the body is not a JSON object or `date` is not three integers. */
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
/** Turns a business-date response into a `Date` at UTC midnight — the run date every workflow, seed value and comparison derives from (Rule 1 clause 2; AAP 0.10.1) (AAP 0.10.3). */
export function parseBusinessDate(body: unknown, source = 'the business-date response'): Date {
  const response = parseBusinessDateResponse(body, source);
  const [year, month, day] = response.date;
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
/** A request this module made that produced no usable answer: no HTTP response at all (connection refused, TLS failure, timeout), or a response Fineract refused (Rule 1 clause 9). */
export class FixtureRequestError extends Error {
  readonly path: string;
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
/** Resource path of the tenant business-date read, `GET /businessdate/BUSINESS_DATE` — harness-only, because the application reads no business date (AAP 0.9.4 row 9; AAP 0.10.4; AAP 0.10.5 item 15). */
const BUSINESS_DATE_PATH = '/businessdate/BUSINESS_DATE';
/** The {@link FixtureRequestError} a transport-level failure raises: status `0`, and the caught error deliberately neither echoed nor chained as `cause`, because Playwright reports a failed API call together with the request headers that carry the credential (Rule 1 clause 9); only the method, the resource path and the URL reach the message. */
function transportFailure(method: 'GET' | 'POST', path: string, url: string): FixtureRequestError {
  return new FixtureRequestError(
    path,
    0,
    `${method} ${url} produced no HTTP response: the connection was refused, the TLS handshake ` +
      'failed or the call timed out.',
  );
}
/** The headers every Fineract request carries: the basic-auth credential, the tenant, and JSON in both directions (AAP 0.7.3), consumed by {@link readBusinessDate}, the seed script, the state snapshot and every page object's API assertions. */
export function apiHeaders(authenticationKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${authenticationKey}`,
    [TENANT_HEADER]: TENANT_ID,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
/** Authenticates against Fineract — `POST /authentication`, workflow W1's first call — and returns the basic-auth credential every later request needs, consumed by {@link readBusinessDate}, the seed script and the state (Rule 1 clause 9). */
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
const MILLISECONDS_PER_DAY = 86_400_000;
let cachedBusinessDate: Date | null = null;
/** Discards the cached run date so the next {@link readBusinessDate} reads it from Fineract again: `npm run e2e` runs the legacy project and then the next one in one command (AAP 0.10.4), and the parity fixture calls this between them so a business date that rolled over mid-run is picked up rather than dated from the previous UI's run. */
export function resetBusinessDateCache(): void {
  cachedBusinessDate = null;
}
/** The run date: the tenant's business date, read from Fineract over the API — the one source every workflow input, seed value and comparison in the harness derives its dates from (Rule 1 clause 2; AAP 0.10.1, "Run date") (AAP 0.9.4, AAP 0.10.4, AAP 0.10.5, Rule 1 clause 9). */
export async function readBusinessDate(authenticationKey?: string): Promise<Date> {
  if (cachedBusinessDate !== null) {
    return new Date(cachedBusinessDate.getTime());
  }
  // Authenticating only when the caller handed over no key keeps one run to a single POST /authentication, and keeps the key sent from here the one the caller registered for masking.
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
/** A date as a Fineract payload carries it: the text, the format that produced the text, and the language the server must read it in (Rule 1 clause 2). */
export interface FineractDatePayload {
  readonly date: string;
  readonly dateFormat: string;
  readonly locale: string;
}
/** Full English month names in calendar order — a fixed table rather than `Intl`, so the text cannot vary with the host's locale data and the harness behaves identically on macOS and in Codespaces (AAP 0.10.3). */
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
/** Formats a date the way every date-bearing Fineract payload carries it, so a payload spreads this object instead of assembling a string by hand (Rule 1 clause 2). The components are read in UTC on purpose, because a UTC-midnight `Date` read with local getters shifts a day in any negative-offset timezone and the same file must answer the same text on both verification platforms (AAP 0.10.3). @throws When `date` is not a valid `Date`. */
export function formatFineractDate(date: Date): FineractDatePayload {
  const monthName = MONTH_NAMES[date.getUTCMonth()];
  if (Number.isNaN(date.getTime()) || monthName === undefined) {
    throw new Error(`formatFineractDate() needs a valid Date; received ${String(date)}`);
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return { date: `${day} ${monthName} ${year}`, dateFormat: PAYLOAD_DATE_FORMAT, locale: LOCALE };
}
function utcMidnight(date: Date, caller: string): number {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${caller}() needs a valid Date; received ${String(date)}`);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
/** A new `Date` at UTC midnight, `n` days after `date` — how the fixtures derive their dates from the run date instead of hard-coding one (AAP 0.10.1); the argument is never mutated and its time of day is discarded, so a clock time can never manufacture a difference. @throws When `date` is not a valid `Date` or `n` is not an integer. */
export function addDays(date: Date, n: number): Date {
  const midnight = utcMidnight(date, 'addDays');
  if (!Number.isInteger(n)) {
    throw new Error(`addDays() needs a whole number of days; received ${String(n)}`);
  }
  return new Date(midnight + n * MILLISECONDS_PER_DAY);
}
/** The whole-day distance from `from` to `to`, positive when `to` is later: AAP 0.10.2 compares dates as day offsets from the run date rather than as literal strings, so a comparison survives a run on a different day. @returns The difference rounded to whole days. @throws When `from` is not a valid `Date`, or `to` is not one or a number that is not finite. */
export function dayOffset(from: Date, to: number | Date): number {
  const start = utcMidnight(from, 'dayOffset');
  const end = typeof to === 'number' ? to : utcMidnight(to, 'dayOffset');
  if (!Number.isFinite(end)) {
    throw new Error(`dayOffset() needs a finite target; received ${String(to)}`);
  }
  return Math.round((end - start) / MILLISECONDS_PER_DAY);
}
/** The payload text form a date-bearing Fineract field carries (Rule 1 clause 2): a 1- or 2-digit day, a full English month name and a 4-digit year, e.g. `21 November 2026`. */
const PAYLOAD_DATE_TEXT_PATTERN = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/;
const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A `Date` at UTC midnight for a 1-based-month calendar date, or `null` when those components are not a real day (`31 February`, month `13`): the round trip is what rejects them, since `Date.UTC` would otherwise roll an impossible day forward into the following month. */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}
/** A date as Fineract reports one, or `null` for any other shape (AAP 0.10.2, Rule 1 clause 2, AAP 0.10.3). */
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
/** A date as `yyyy-mm-dd` in UTC — the run-date metadata form both capture writers record, so a written capture names the day its offsets are measured from (AAP 0.10.2); UTC and zero padding together make that text a calendar day that compares as text (AAP 0.10.3). @throws When `date` is not a valid `Date`. */
export function formatDateOnly(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateOnly() needs a valid Date; received ${String(date)}`);
  }
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${month}-${day}`;
}
/** The staff member the seed creates — the AAP 0.10.1 row "Staff: Parity Officer, loan officer, office 1 (Head Office)". The table gives one two-word value and Fineract's staff record keeps a first and a last name, so the pair below is that value split at its space — `Parity`, then `Officer` — rather than either name invented. */
export interface StaffSeed {
  readonly firstname: string;
  readonly lastname: string;
  /** Name the client and loan screens display: Fineract composes the last name, a comma and a space, then the first name (`StaffWriteServiceImpl.createStaff`), so this seed's is `Officer, Parity` rather than the AAP table's `Parity Officer`, and the staff dropdowns label their options with it. */
  readonly displayName: string;
  readonly officeId: number;
  readonly officeName: string;
  readonly isLoanOfficer: boolean;
}
/** The seed staff member of AAP 0.10.1, consumed by `seed/seed.ts` and by the loan page objects, which select its `displayName` as the loan officer. */
export const SEED_STAFF = {
  firstname: 'Parity',
  lastname: 'Officer',
  displayName: 'Officer, Parity',
  officeId: 1,
  officeName: 'Head Office',
  isLoanOfficer: true,
} as const satisfies StaffSeed;
/** The loan product the seed creates — the AAP 0.10.1 row "Parity Loan, currency USD, principal min 1,000, default 5,000, max 10,000, 12 monthly repayments, flat interest 12% per year", in the table's own vocabulary. The Fineract enum ids these words map to belong to `seed/seed.ts`, which owns the request bodies: this module holds the fixed values, not the mapping. */
export interface LoanProductSeed {
  readonly name: string;
  readonly currencyCode: string;
  readonly minPrincipal: number;
  readonly principal: number;
  readonly maxPrincipal: number;
  readonly numberOfRepayments: number;
  readonly repaymentEveryMonths: number;
  readonly interest: 'flat';
  readonly interestRatePerYear: number;
}
/** The seed loan product of AAP 0.10.1, consumed by the seed script, the loan page objects and W4, W5, W6 and W7. */
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
/** The loan charge the seed creates — the AAP 0.10.1 row "Parity Fee, flat amount 25, specified due date", in the table's own vocabulary; as with {@link LoanProductSeed}, the Fineract enum ids belong to `seed/seed.ts`. */
export interface LoanChargeSeed {
  readonly name: string;
  readonly amount: number;
  readonly currencyCode: string;
  readonly appliesTo: 'loan';
  readonly timeType: 'specified due date';
  readonly calculation: 'flat';
}
/** The seed loan charge of AAP 0.10.1, consumed by the seed script and by the loan charge specs. `seed/seed.ts` creates it in Regular payment mode (`chargePaymentMode: 0`) rather than account transfer, because this backend adds and pays an account-transfer loan charge only against a loan-linked, funded savings account and the savings family is cut by AAP 0.9.3's fixed order — so the pay command's one reachable outcome against this fixture is the server's refusal, which `e2e/report/difference-register.ts` registers. */
export const SEED_LOAN_CHARGE = {
  name: 'Parity Fee',
  amount: 25,
  currencyCode: 'USD',
  appliesTo: 'loan',
  timeType: 'specified due date',
  calculation: 'flat',
} as const satisfies LoanChargeSeed;
/** One narration value a client lifecycle action needs: an entry of the `narrations` list `GET /clients/template?commandParam=<close|reject|withdraw>` answers with, and the reason id the matching `POST /clients/{id}?command=<close|reject|withdraw>` sends (AAP 0.10.1, AAP 0.9.1). */
export interface ClientActionReasonSeed {
  /** Narration code the value belongs to, as `GET /codes` names it, e.g. `ClientClosureReason`; the seed keys its write by this name rather than by the code's numeric id, which the tenant's migration creates and this repository may not fix. */
  readonly codeName: string;
  readonly valueName: string;
}
export interface ClientActionReasonsSeed {
  readonly closure: ClientActionReasonSeed;
  readonly rejection: ClientActionReasonSeed;
  readonly withdrawal: ClientActionReasonSeed;
}
export const SEED_CLIENT_ACTION_REASONS = {
  closure: { codeName: 'ClientClosureReason', valueName: 'Parity Closure Reason' },
  rejection: { codeName: 'ClientRejectReason', valueName: 'Parity Rejection Reason' },
  withdrawal: { codeName: 'ClientWithdrawReason', valueName: 'Parity Withdrawal Reason' },
} as const satisfies ClientActionReasonsSeed;
/** The one column of {@link ClientActionGateSeed}'s datatable, as `POST /datatables` declares it. */
export interface ClientActionGateColumnSeed {
  readonly name: string;
  readonly type: 'String';
  readonly length: number;
  /** Whether Fineract refuses a row without a value: `false`, so the row a legacy front end posts before an action can never be rejected on this column. */
  readonly mandatory: boolean;
}
/** The client datatable and its entity-datatable check — the fixture the datatable gate is exercised with, and the reason the gate's two calls have rows to read at all (AAP 0.7.3). */
export interface ClientActionGateSeed {
  readonly datatableName: string;
  /** Entity the table hangs off — `m_client`, the entity the AAP 0.7.3 gate row names. */
  readonly apptableName: string;
  readonly entitySubType: 'none';
  readonly multiRow: boolean;
  readonly column: ClientActionGateColumnSeed;
  /** Status the check is registered for: `600`, the CLOSE status, not `300` (ACTIVATE). A legacy client action submits a datatable row before the action when the check's status matches and the client has no row (`submitDatatable`), which would add a request legacy's W2 makes and the new app's does not; CLOSE keeps W2 identical on both front ends and puts the check and its table on the in-scope close screen, where the gate's two-call read is observable. */
  readonly checkStatus: number;
  readonly checkStatusMeaning: 'close';
}
export const SEED_CLIENT_ACTION_GATE = {
  datatableName: 'client_action_check',
  apptableName: 'm_client',
  entitySubType: 'none',
  multiRow: false,
  column: { name: 'notes', type: 'String', length: 100, mandatory: false },
  checkStatus: 600,
  checkStatusMeaning: 'close',
} as const satisfies ClientActionGateSeed;
export interface ScenarioClient {
  readonly firstname: string;
  readonly lastname: string;
  readonly displayName: string;
  readonly officeId: number;
  readonly officeName: string;
}
export interface ScenarioLoanApplication {
  readonly productName: string;
  readonly principal: number;
}
/** How W6 derives its repayment rather than being handed a number: the AAP 0.10.1 row defines it as "the first period's total due from the loan's repayment schedule", a value that exists only once the loan is disbursed, so a fabricated amount would break W6 and the W2-to-W6 chain. */
export interface ScenarioRepayment {
  readonly amountSource: 'first-schedule-period-total-due';
  readonly transactionDateSource: 'disbursement-date';
}
/** The fixed test data of AAP 0.10.1 as the workflows that consume it read it — consumed by the seed script, the page objects, the state snapshot and the specs for W2, W3, W4 and W7; only what the table names is here (Rule 1 clause 3), with no extra fixture or field and no rounded or renamed value. */
export interface Scenario {
  readonly client: ScenarioClient;
  readonly loanApplication: ScenarioLoanApplication;
  readonly invalidLoanApplication: ScenarioLoanApplication;
  readonly repayment: ScenarioRepayment;
}
/** The fixed parity data of AAP 0.10.1, consumed by the seed script, the page objects, the state snapshot and the specs. */
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
  repayment: {
    amountSource: 'first-schedule-period-total-due',
    transactionDateSource: 'disbursement-date',
  },
} as const satisfies Scenario;
