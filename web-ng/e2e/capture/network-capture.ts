/**
 * Playwright traffic recorder for the legacy-versus-next parity suite: it records every Fineract API
 * exchange a page makes during one workflow on one front end, normalises each exchange before
 * anything is serialised, and diffs two normalised captures.
 *
 * Why this module exists. Parity here is behavioural, not visual (AAP 0.1.1): a workflow passes when
 * the new application reaches the same Fineract end state through the same ordered API calls as the
 * legacy application (AAP 0.10.1). That comparison only says something once incidental variance has
 * been removed, so the removal happens here — {@link diffExchanges} then compares behaviour instead
 * of run-specific ids, clocks and key order. The normalisation rules are AAP 0.10.2, applied in the
 * order listed below.
 *
 * Rule 1 clause 9 is discharged in the same place. The `Authorization` header, the authentication
 * key and every password field are masked before an exchange record exists, so no later code path —
 * a report writer, a diff, a captured file — can serialise them: headers are reduced to presence
 * booleans and secret-named body fields become {@link MASKED}. The module keeps no credential in a
 * variable, writes none to a message and holds no logger.
 *
 * The only artefact written is one JSON file under `web-ng/e2e/.captures/network/`, at a path fixed
 * by the project and workflow id ({@link CAPTURES_DIR}), so two runs that made the same calls with
 * the same run date produce byte-identical files (AAP 0.10.2, determinism).
 *
 * Normalisation applied to every recorded exchange, in this order:
 *
 * 1. **Filtering** — only `fetch`/`xhr` requests below `/fineract-provider/` that are not static
 *    assets are recorded; the document, legacy `views/**` partials, translations, fonts and images
 *    are dropped before a record exists.
 * 2. **Masking** — `Authorization` and tenant headers are reduced to presence booleans; secret-named
 *    body fields become {@link MASKED}; a request body that is not JSON becomes a fixed marker.
 * 3. **Path templating** — numeric segments become role tokens: `/clients/123` → `/clients/{clientId}`.
 * 4. **Body ids** — a numeric value under an id-named key becomes the role token of the id it
 *    carries, so a generated id is compared by its role and its sequence, never by its value.
 * 5. **Dates** — a `…date` string in the payload format becomes a day offset from the run date:
 *    `21 November 2026` on a run date of the same day becomes `d0` (AAP 0.10.1, "Run date").
 * 6. **Audit block** — `timestamps` subtrees are dropped from response bodies; no workflow asserts
 *    them.
 * 7. **Query parameters** — keys sorted ascending, a repeated key joined with `,` in its own order;
 *    `command` is kept because it distinguishes Fineract action endpoints.
 * 8. **Key order** — every object's keys sorted recursively at normalisation time; arrays keep their
 *    order, because schedule periods, transactions and charges are ordered data (AAP 0.10.2).
 */
import * as filesystem from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Request, Response } from '@playwright/test';

import { PAYLOAD_DATE_FORMAT, dayOffset } from '../seed/fixtures';

/**
 * What every masked field is replaced with. A fixed string, so the two front ends' captures compare
 * equal by construction and a reader can see that a value was deliberately hidden rather than absent.
 */
export const MASKED = '***';

/**
 * Extensions of the files a page fetches as part of rendering rather than as an API call. AAP 0.10.2
 * excludes static assets from the comparison and from the parity fixture's host assertion, which is
 * why {@link isStaticAssetUrl} is exported: both sides of that rule read this one definition.
 */
export const STATIC_ASSET_EXTENSIONS: readonly string[] = [
  'js',
  'css',
  'map',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
];

/**
 * Path prefixes served as static assets without a file extension: the built application's `assets/`
 * directory and the legacy translations the new app loads in place (AAP 0.4.4).
 */
const STATIC_PATH_PREFIXES: readonly string[] = ['/assets/', '/global-translations/'];

/**
 * The prefix every Fineract API call carries (AAP 0.7.3), held as a pattern because this module only
 * ever tests a pathname against it: only the application's services compose Fineract URLs, and the
 * capture records whatever they sent. A pattern rather than a string also keeps the module from
 * carrying an API-shaped literal, which `tools/parity/check-endpoints.ts` would have to be taught to
 * exempt — a recorder holds no URL it is allowed to call.
 */
const API_PATH_PREFIX = /^\/fineract-provider\//;

/**
 * The tenant header's *name* — the API contract's own constant, not tenant data. The value the
 * header carries is tenant data and is never read into a record (Rule 1 clause 9, AAP 0.4.2): only
 * its presence is kept, as `hasTenantHeader`.
 */
const TENANT_HEADER_NAME = 'Fineract-Platform-TenantId';

/** The credential header, compared by lowercase name because `Request.headers()` lower-cases keys. */
const AUTHORIZATION_HEADER_NAME = 'authorization';

/**
 * Stored in place of a request body that is not JSON. Such a body cannot be masked field by field
 * (Rule 1 clause 9), so it is never stored: the marker says a body was sent, and the two front ends
 * compare equal when they both sent a non-JSON body to the same endpoint.
 */
const NON_JSON_BODY = '<non-json body>';

/**
 * Body fields that carry a credential (Rule 1 clause 9): Fineract's `base64EncodedAuthenticationKey`
 * in the authentication response (AAP 0.7.2 `AuthResponse`), and the login form's `password`. Held as
 * a pattern rather than as a string so the field *names* are documented without any value near them.
 */
const SECRET_KEY_PATTERN = /password|^pass$|authenticationKey/i;

/** A key carrying a record id, e.g. `id`, `clientId`, `statusId`. */
const ID_KEY_PATTERN = /^(id|.*Id)$/;

/** A key carrying a date, e.g. `submittedOnDate`, `dueDate`, `approvedOnDate`. */
const DATE_KEY_PATTERN = /date$/i;

/**
 * Fineract's server-side audit block. AAP 0.10.2 drops timestamps no workflow asserts; the whole
 * subtree goes, because its `[year, month, day]` arrays would otherwise need date normalisation of
 * their own for values nothing compares.
 */
const AUDIT_BLOCK_KEY = 'timestamps';

/** Request kinds that can carry an API call; a `document` request is a page load, never an API call. */
const API_RESOURCE_TYPES: readonly string[] = ['fetch', 'xhr'];

/**
 * Absolute directory this module writes into: `web-ng/e2e/.captures`, resolved from this file's own
 * location rather than from the working directory, so it is the same however the suite is launched
 * (AAP 0.8.1, 0.11.1). `web-ng/.gitignore` ignores `/e2e/.captures`, so nothing written here can be
 * committed. `capture/state-snapshot.ts` imports this constant instead of recomputing the path.
 */
export const CAPTURES_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.captures');

/**
 * A JSON-shaped value after normalisation: every scalar a Fineract payload can carry, and the arrays
 * and objects built from them. Nothing else survives {@link normaliseValue}, so a record is always
 * serialisable and a diff always has a value to compare.
 */
export type NormalizedValue =
  | string
  | number
  | boolean
  | null
  | NormalizedValue[]
  | { [key: string]: NormalizedValue };

/**
 * One Fineract API exchange, normalised as AAP 0.10.2 requires. Every field is a value two runs must
 * agree on; the fields that are deliberately absent are as important as the ones present — no headers
 * (only their presence), no timestamps, no generated ids, no query ordering.
 */
export interface NormalizedExchange {
  /** HTTP method, upper-cased. */
  readonly method: string;
  /** Origin the call went to, e.g. `https://localhost:8443`; kept so the parity fixture can prove the
   * run never left the configured backend (Rule 2), and deliberately not compared by
   * {@link diffExchanges}. */
  readonly origin: string;
  /** Pathname with numeric segments templated by role, e.g. `/fineract-provider/api/v1/clients/{clientId}`. */
  readonly path: string;
  /** Query parameters with keys sorted ascending; a repeated key keeps its values joined with `,`. */
  readonly query: Readonly<Record<string, string>>;
  /** HTTP status, or `0` when no response arrived (a failed request is still evidence). */
  readonly status: number;
  /** Whether the tenant header was present. Its value is tenant data and is never recorded. */
  readonly hasTenantHeader: boolean;
  /** Whether the credential header was present. Its value is never recorded (Rule 1 clause 9). */
  readonly hasAuthorizationHeader: boolean;
  /** Masked, canonicalised request body; `null` when the request carried none. */
  readonly requestBody: NormalizedValue | null;
  /** Masked, canonicalised response body; `null` when no JSON body arrived. */
  readonly responseBody: NormalizedValue | null;
}

/**
 * The tokens one capture's generated ids were mapped to: the real id as a string, and the role token
 * it became, e.g. `'123' -> '{clientId}'` (AAP 0.10.2, "ids compared by role in the sequence").
 */
export interface RoleMap {
  readonly [realId: string]: string;
}

/**
 * A whole capture: the metadata that makes the written file self-describing, plus its exchanges and
 * the role tokens they produced.
 */
export interface NormalizedCapture {
  /** Playwright project the capture came from: `legacy` or `next`, `null` when unset. */
  readonly project: string | null;
  /** Workflow id the capture covers, e.g. `W2` or `CHAIN`, `null` when unset. */
  readonly workflow: string | null;
  /** The run date the dates were offset from, `yyyy-mm-dd`, or `null` when no run date was supplied. */
  readonly runDate: string | null;
  /** Exchanges in the order the page issued them — the order AAP 0.10.1 compares. */
  readonly exchanges: readonly NormalizedExchange[];
  /** Real id to role token, for readers of the written file. */
  readonly roles: RoleMap;
}

/** How one capture is started. Every field is optional, so a caller can record first and annotate later. */
export interface CaptureOptions {
  /** Playwright project the capture belongs to. */
  project?: 'legacy' | 'next';
  /** Workflow id the capture covers, e.g. `'W2'` or `'CHAIN'`. */
  workflow?: string;
  /** The tenant's business date read from Fineract (AAP 0.10.1), never the browser clock; dates in
   * payloads are converted to offsets from it. Without it, dates stay verbatim. */
  runDate?: Date;
  /** Directory to write into instead of {@link CAPTURES_DIR}; used only by the module's own tests. */
  outputDir?: string;
}

/** A running capture. `stop()` and `write()` may be called in either order, and each one answers for
 * the other. */
export interface CaptureSession {
  /** The capture being built; its `exchanges` fills as the page makes calls and `roles` answers for
   * whatever has been recorded so far. */
  readonly capture: NormalizedCapture;
  /** Detaches the page listeners, freezes the records, is idempotent, and returns the exchanges. */
  stop(): NormalizedExchange[];
  /** Writes the capture and returns the absolute path of the file it wrote. */
  write(folder?: string): string;
}

/**
 * One difference between two captures. AAP 0.10.2 compares the ordered API calls, so a difference is
 * always anchored to the exchange it occurred in — by position, method and path.
 */
export interface ExchangeDiff {
  /** Position of the exchange in both captures, from zero. */
  readonly index: number;
  /** Method of the exchange the difference belongs to; the legacy side's when both exist. */
  readonly method: string;
  /** Normalised path of that exchange, so a reader can find it without reading the capture. */
  readonly path: string;
  /** What differs, as a value path: `method`, `path`, `query.command`, `status`,
   * `hasTenantHeader`, `hasAuthorizationHeader`, `requestBody.principal`,
   * `responseBody.errors[0].defaultUserMessage`, or `exchange` when a counterpart is missing. */
  readonly field: string;
  /** The legacy side's value; `null` when that side has no such value or no such exchange. */
  readonly legacy: NormalizedValue;
  /** The new app's value; `null` when that side has no such value or no such exchange. */
  readonly next: NormalizedValue;
}

/**
 * Whether a URL addresses a static asset rather than an API call.
 *
 * Exported because AAP 0.10.2 excludes static assets from the comparison *and* from the parity
 * fixture's host assertion, and a second definition in the fixture would let the two drift apart.
 * An unparseable string answers `false` rather than throwing: the caller is classifying a URL a
 * browser produced, and a capture must never fail over one odd string.
 *
 * @param url Absolute URL to classify.
 */
export function isStaticAssetUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const lower = pathname.toLowerCase();
  if (STATIC_PATH_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  const lastSegment = lower.slice(lower.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return dot >= 0 && STATIC_ASSET_EXTENSIONS.includes(lastSegment.slice(dot + 1));
}

/**
 * The role tokens one exchange's ids were mapped to, assigned in the order that exchange presents
 * them: its path segments left to right, then its request body in sorted-key order, then its response
 * body.
 *
 * A registry belongs to a single exchange rather than to the whole capture, and that is what keeps
 * the artefact deterministic. A response body is normalised when its `json()` promise settles, and two
 * parallel requests can settle in either order, so a registry shared across exchanges could hand
 * `{loanId}` and `{loanId_2}` to the same two ids in an order that differs between the legacy run and
 * the new-app run — a difference the diff would then report as behaviour. Scoped per exchange, the
 * sequence is intrinsic to the payload, which is the only order both front ends share. A token
 * depends on a role and a position, never on a value, so payloads with the same shape still
 * normalise to the same tokens on both sides.
 */
class RoleRegistry {
  /** `${role}\u0000${realId}` to the token that id was given. */
  private readonly tokens = new Map<string, string>();

  /** Role to the number of distinct ids it has been given, which yields the `_2`, `_3` suffixes. */
  private readonly counts = new Map<string, number>();

  /** Registrations in the order they happened, so the capture-level {@link RoleMap} is stable. */
  private readonly order: { readonly realId: string; readonly token: string }[] = [];

  /**
   * The token for one id under one role, registering it when this exchange has not named it yet.
   *
   * @param role Role the id belongs to, e.g. `clientId`.
   * @param realId The id exactly as it appeared: digits only, as Fineract sends it.
   */
  token(role: string, realId: string): string {
    const key = `${role}\u0000${realId}`;
    const known = this.tokens.get(key);
    if (known !== undefined) {
      return known;
    }
    const count = (this.counts.get(role) ?? 0) + 1;
    this.counts.set(role, count);
    const assigned = count === 1 ? `{${role}}` : `{${role}_${count}}`;
    this.tokens.set(key, assigned);
    this.order.push({ realId, token: assigned });
    return assigned;
  }

  /** Every registration this exchange made, in order. */
  entries(): readonly { readonly realId: string; readonly token: string }[] {
    return this.order;
  }
}

/**
 * Role names for the collections the harness meets, keyed by the path segment that holds the id.
 * AAP 0.7.3's resources spell the collection in lower case and Fineract's model spells the id in
 * camel case; naming the ones in scope here keeps `{savingsAccountId}` from becoming
 * `{savingsaccountId}`.
 */
const ROLE_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ['clients', 'clientId'],
  ['loans', 'loanId'],
  ['savingsaccounts', 'savingsAccountId'],
  ['users', 'userId'],
  ['charges', 'chargeId'],
  ['identifiers', 'identifierId'],
  ['transactions', 'transactionId'],
  ['loanproducts', 'loanProductId'],
  ['savingsproducts', 'savingsProductId'],
  ['staff', 'staffId'],
  ['offices', 'officeId'],
  ['datatables', 'dataTableId'],
  ['paymenttypes', 'paymentTypeId'],
]);

/**
 * The plural collection noun as a singular one, for a collection {@link ROLE_NAMES} does not name:
 * `reports` becomes `report`, while a noun that is already singular — or that merely ends in `us` or
 * `ss`, as `status` and `address` do — is left alone.
 */
function singularise(noun: string): string {
  if (noun.endsWith('ies') && noun.length > 3) {
    return `${noun.slice(0, -3)}y`;
  }
  if (noun.endsWith('ss') || noun.endsWith('us')) {
    return noun;
  }
  return noun.endsWith('s') && noun.length > 1 ? noun.slice(0, -1) : noun;
}

/**
 * The role an id segment carries: named for the collection it identifies, and `id` when the path
 * offers it none — a bare numeric segment at the start of a path has no collection to belong to.
 */
function roleForSegment(segments: readonly string[], position: number): string {
  const parent: string | undefined = position > 0 ? segments[position - 1] : undefined;
  if (parent === undefined || parent.length === 0 || /^\d+$/.test(parent)) {
    return 'id';
  }
  const named = ROLE_NAMES.get(parent);
  return named ?? `${singularise(parent)}Id`;
}

/**
 * Templates an id-carrying path by role, registering each id in its exchange's registry, so a path
 * compares as `/fineract-provider/api/v1/clients/{clientId}` whichever client the run happened to
 * create (AAP 0.10.2, "ids compared by role").
 *
 * @param pathname URL pathname, e.g. `/fineract-provider/api/v1/clients/123/accounts`.
 * @param roles Registry of the exchange this path belongs to.
 */
function normalisePath(pathname: string, roles: RoleRegistry): string {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const templated = segments.map((segment, position) =>
    /^\d+$/.test(segment) ? roles.token(roleForSegment(segments, position), segment) : segment,
  );
  return `/${templated.join('/')}`;
}

/**
 * The query parameters of one call, keys sorted ascending so `?limit=-1&offset=0` and
 * `?offset=0&limit=-1` normalise alike. A repeated key keeps its own values in their own order, joined
 * with `,`: the order inside a key is the caller's, and discarding it would hide a real difference.
 * `command` is kept because it is what separates Fineract's action endpoints (AAP 0.7.3).
 */
function normaliseQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of [...new Set(url.searchParams.keys())].sort()) {
    query[key] = url.searchParams.getAll(key).join(',');
  }
  return query;
}

/**
 * Whether a header is present, compared case-insensitively because HTTP header names are not
 * case-sensitive and either front end may send any casing.
 *
 * Only presence leaves this function. The two headers this module asks about carry a credential and
 * tenant data, and neither value is read into a record, a message or a file (Rule 1 clause 9;
 * AAP 0.4.2 keeps the tenant out of captured traffic).
 */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === wanted);
}

/**
 * Full English month names in calendar order: the inverse of the fixed table `../seed/fixtures` uses
 * to format a payload date. A fixed table rather than `Intl`, so the text cannot vary with the host's
 * locale data and the harness behaves identically on macOS and in Codespaces (AAP 0.10.3).
 */
const MONTH_NAMES: readonly string[] = [
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
];

/** Each token {@link PAYLOAD_DATE_FORMAT} may contain, and the capture group that reads it. */
const DATE_FORMAT_TOKENS: readonly { readonly token: string; readonly group: string }[] = [
  { token: 'dd', group: '(\\d{2})' },
  { token: 'MMMM', group: '([A-Za-z]+)' },
  { token: 'yyyy', group: '(\\d{4})' },
];

/**
 * Builds the pattern that reads a date written in `format`, so the parser is derived from the format
 * the harness sends instead of restating it. A character that starts no token is a literal separator
 * — the spaces of `dd MMMM yyyy` — and is matched as it stands.
 */
function compileDateFormat(format: string): { readonly pattern: RegExp; readonly tokens: readonly string[] } {
  const tokens: string[] = [];
  let source = '^';
  let index = 0;
  while (index < format.length) {
    const known = DATE_FORMAT_TOKENS.find((entry) => format.startsWith(entry.token, index));
    if (known === undefined) {
      const separator = format.charAt(index);
      source += separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      index += 1;
      continue;
    }
    source += known.group;
    tokens.push(known.token);
    index += known.token.length;
  }
  return { pattern: new RegExp(`${source}$`), tokens };
}

/**
 * The payload date format compiled once: `dd MMMM yyyy` becomes `/^(\d{2}) ([A-Za-z]+) (\d{4})$/`.
 * Every Fineract date-bearing payload carries that format beside a `locale` (Rule 1 clause 2), which
 * is what makes a date recognisable inside an otherwise unmodelled body.
 */
const PAYLOAD_DATE_PATTERN = compileDateFormat(PAYLOAD_DATE_FORMAT);

/**
 * Reads a date written in {@link PAYLOAD_DATE_FORMAT}, or answers `null` when the text is not one.
 * The reconstructed calendar day is checked against the parsed date, so `31 February 2026` is
 * rejected rather than silently rolled into March. Every component is read in UTC, matching the
 * formatter in `../seed/fixtures`, so the same text answers the same day on both verification
 * platforms.
 */
function parsePayloadDate(text: string): Date | null {
  const groups = PAYLOAD_DATE_PATTERN.pattern.exec(text.trim());
  if (groups === null) {
    return null;
  }
  let day = 0;
  let month = -1;
  let year = 0;
  PAYLOAD_DATE_PATTERN.tokens.forEach((token, position) => {
    const group = groups[position + 1];
    if (token === 'dd') {
      day = Number(group);
    } else if (token === 'yyyy') {
      year = Number(group);
    } else {
      month = MONTH_NAMES.indexOf(group);
    }
  });
  if (day < 1 || month < 0) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) {
    return null;
  }
  return parsed;
}

/**
 * A date as a day offset from the run date: `d0` for the run date itself, `d+1` the day after, `d-2`
 * two days before. AAP 0.10.2 compares dates as offsets, so a capture taken on a different business
 * date still compares equal; the arithmetic belongs to `dayOffset()` in `../seed/fixtures`, which
 * owns whole-day handling for the whole harness.
 */
function dateOffsetToken(date: Date, runDate: Date): string {
  const offset = dayOffset(runDate, date);
  if (offset === 0) {
    return 'd0';
  }
  return offset > 0 ? `d+${offset}` : `d${offset}`;
}


/** What one body needs to know while it is normalised. */
interface WalkContext {
  /** Registry of the exchange the body belongs to. */
  readonly roles: RoleRegistry;
  /** The tenant's business date, or `null` to leave payload dates verbatim. */
  readonly runDate: Date | null;
  /** Whether to drop the server-side audit block; a response body carries one, a request never does. */
  readonly dropAuditBlock: boolean;
}

/** Narrows a parsed JSON payload to a JSON object, leaving the values inside it unmodelled. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The role a body id belongs to: the key itself when it names one (`clientId`), the enclosing key
 * when the key is a bare `id` (`statusId` for `{status: {id: 1}}`), and `id` when neither names
 * anything — the shape Fineract uses for a bare record at the top of a body.
 */
function roleForKey(key: string, parentKey: string): string {
  if (key !== 'id' && ID_KEY_PATTERN.test(key)) {
    return `${key.charAt(0).toLowerCase()}${key.slice(1)}`;
  }
  return parentKey.length > 0 ? `${parentKey}Id` : 'id';
}

/**
 * Normalises one JSON value: masks a secret-named field, canonicalises key order, turns an id into a
 * role token, turns a payload date into a day offset and drops the audit block, in the single pass
 * that also builds the record (AAP 0.10.2).
 *
 * Every `unknown` reached here is a Fineract request or response body — payload JSON this harness
 * does not model field by field, because comparing payloads the application is not typed for at the
 * boundary is the whole purpose of the capture. Narrowing to `unknown` and checking each JSON kind as
 * it is walked is the documented boundary Rule 1 clause 4 permits; an `any` would carry the payload's
 * shape into this module unchecked, and masking (Rule 1 clause 9) must not be able to miss a field.
 *
 * @param value Value to normalise.
 * @param context What the body needs while it is normalised.
 * @param key The key this value sits under, or `''` at the top of a body.
 * @param parentKey The nearest enclosing object key, which names the role of a bare `id`.
 * @returns The normalised value, or `undefined` when the record must omit the value entirely.
 */
function normaliseValue(
  value: unknown,
  context: WalkContext,
  key: string,
  parentKey: string,
): NormalizedValue | undefined {
  if (SECRET_KEY_PATTERN.test(key)) {
    return MASKED;
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    // Arrays keep their order: repayment-schedule periods, transactions and charges are ordered data
    // (AAP 0.10.2). An element sits under the same key as its array, so the role context is unchanged.
    return value.map((element) => normaliseValue(element, context, key, parentKey) ?? null);
  }
  if (isJsonObject(value)) {
    const normalised: { [field: string]: NormalizedValue } = {};
    // Sorted keys: canonicalisation happens here, once, and never at comparison time (AAP 0.10.2).
    for (const field of Object.keys(value).sort()) {
      if (context.dropAuditBlock && field === AUDIT_BLOCK_KEY) {
        continue;
      }
      const child = normaliseValue(value[field], context, field, key);
      if (child !== undefined) {
        normalised[field] = child;
      }
    }
    return normalised;
  }
  if (typeof value === 'string') {
    return normaliseText(value, context, key, parentKey);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? normaliseNumber(value, context, key, parentKey) : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  // JSON cannot carry anything else, and `undefined` is how a key that must not appear is expressed.
  return undefined;
}

/**
 * Normalises a string field: a payload date becomes a day offset, a numeric value under an id-named
 * key becomes a role token, and everything else — including `dateFormat` and `locale`, whose values
 * AAP 0.10.2 compares verbatim — is kept as it stands.
 */
function normaliseText(value: string, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  if (context.runDate !== null && DATE_KEY_PATTERN.test(key)) {
    const parsed = parsePayloadDate(value);
    if (parsed !== null) {
      return dateOffsetToken(parsed, context.runDate);
    }
  }
  if (ID_KEY_PATTERN.test(key) && /^\d+$/.test(value)) {
    return context.roles.token(roleForKey(key, parentKey), value);
  }
  return value;
}

/** Normalises a number field: an integer under an id-named key becomes a role token. */
function normaliseNumber(value: number, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  if (ID_KEY_PATTERN.test(key) && Number.isInteger(value) && value >= 0) {
    return context.roles.token(roleForKey(key, parentKey), String(value));
  }
  return value;
}

/**
 * A whole body after normalisation, or `null` when there is no body to record. A body that normalises
 * to nothing at all is `null` rather than an empty object, so "no body" and "an empty body" stay
 * distinguishable.
 */
function normaliseBody(payload: unknown, context: WalkContext): NormalizedValue | null {
  return normaliseValue(payload, context, '', '') ?? null;
}

/**
 * The request body of one exchange, masked and normalised, or `null` when the request carried none.
 *
 * A body that is not JSON is never stored — it cannot be masked field by field, and Rule 1 clause 9
 * forbids an unmasked body reaching the capture — so {@link NON_JSON_BODY} stands in for it.
 */
function readRequestBody(request: Request, context: WalkContext): NormalizedValue | null {
  let raw: string | null;
  try {
    raw = request.postData();
  } catch {
    // A body that is no longer readable (the page went away, or the browser released the buffer) is
    // recorded as absent instead of failing the capture it belongs to.
    return null;
  }
  if (raw === null || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = request.postDataJSON();
  } catch {
    return NON_JSON_BODY;
  }
  if (parsed === null && raw.trim() !== 'null') {
    return NON_JSON_BODY;
  }
  return normaliseBody(parsed, context);
}

/** One exchange while it is being filled; frozen and handed out as a {@link NormalizedExchange} on
 * {@link CaptureSession.stop}. */
interface MutableExchange {
  method: string;
  origin: string;
  path: string;
  query: Record<string, string>;
  status: number;
  hasTenantHeader: boolean;
  hasAuthorizationHeader: boolean;
  requestBody: NormalizedValue | null;
  responseBody: NormalizedValue | null;
}

/** An exchange paired with the registry that normalises it, so a late response body still has one. */
interface TrackedExchange {
  readonly record: MutableExchange;
  readonly roles: RoleRegistry;
}

/**
 * The run date as `yyyy-mm-dd`, read in UTC so the written capture carries a calendar day and never a
 * clock time or a host-specific rendering (AAP 0.10.2, determinism).
 */
function formatRunDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The run date a capture was given, copied so later mutation by the caller cannot move the offsets
 * this capture has already written.
 *
 * @throws When the date is invalid. A capture normalised against an unusable run date would leave
 * every date verbatim and report differences that are not behaviour, so the mistake is raised where
 * it is made rather than silently absorbed.
 */
function requireRunDate(date: Date): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      'startCapture() needs a valid run date; pass the tenant business date read from Fineract ' +
        '(AAP 0.10.1), never the browser clock.',
    );
  }
  return new Date(date.getTime());
}


/**
 * Starts recording the Fineract API exchanges of one page.
 *
 * The listeners attach to a page the caller already drives: nothing is created, navigated or awaited
 * here, so a caller starts a capture before its first interaction and stops it in teardown. A page
 * that was already closed is tolerated — the session then records no exchanges and still writes,
 * which a parity report shows as a workflow that made no API calls rather than as a crash during
 * teardown.
 *
 * @param page Playwright page whose traffic belongs to the workflow.
 * @param options Project and workflow the capture belongs to, the run date its dates are measured
 * from, and the directory it is written to.
 * @throws When `options.runDate` is an invalid `Date`; see {@link requireRunDate}.
 */
export function startCapture(page: Page, options: CaptureOptions = {}): CaptureSession {
  const project = options.project ?? null;
  const workflow = options.workflow ?? null;
  const runDate = options.runDate === undefined ? null : requireRunDate(options.runDate);
  const outputDir = options.outputDir;

  const tracked: TrackedExchange[] = [];
  const byRequest = new Map<Request, TrackedExchange>();
  let stopped = false;
  /** The frozen exchanges, built once so `stop()` answers with the same array however often it is
   * called and `capture.exchanges` agrees with it afterwards. */
  let frozen: NormalizedExchange[] | null = null;

  /**
   * Records one request. Only a Fineract API call becomes an exchange: AAP 0.10.1 compares "the
   * ordered API calls", so the HTML document, the legacy app's AngularJS `views/**` partials (which
   * the new app never fetches), translation files, images and fonts are dropped before a record
   * exists — keeping any of them would manufacture a difference that says nothing about behaviour.
   */
  const onRequest = (request: Request): void => {
    if (stopped || !API_RESOURCE_TYPES.includes(request.resourceType())) {
      return;
    }
    const url = request.url();
    if (isStaticAssetUrl(url)) {
      return;
    }
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return;
    }
    if (!API_PATH_PREFIX.test(target.pathname)) {
      return;
    }
    let headers: Record<string, string> = {};
    try {
      // `headers()` is the synchronous view of the headers the browser actually sent. It omits
      // cookie-related headers only, so both headers that matter here are visible: the front ends set
      // them from JavaScript on every call.
      headers = request.headers();
    } catch {
      // A request torn away from its page has no readable headers; it is still recorded, without them.
    }
    const roles = new RoleRegistry();
    const record: MutableExchange = {
      method: request.method().toUpperCase(),
      origin: target.origin,
      path: normalisePath(target.pathname, roles),
      query: normaliseQuery(target),
      status: 0,
      hasTenantHeader: hasHeader(headers, TENANT_HEADER_NAME),
      hasAuthorizationHeader: hasHeader(headers, AUTHORIZATION_HEADER_NAME),
      requestBody: readRequestBody(request, { roles, runDate, dropAuditBlock: false }),
      responseBody: null,
    };
    const entry: TrackedExchange = { record, roles };
    tracked.push(entry);
    byRequest.set(request, entry);
  };

  /**
   * Attaches a response to the exchange its request created, and reads its body when that body is
   * JSON.
   *
   * A body arrives as a promise, so what a capture holds at any moment is what has resolved by then.
   * `write()` serialises exactly that, which is why the parity fixture stops and writes in teardown:
   * teardown runs after the workflow's assertions, and those assertions have necessarily read every
   * body the workflow depends on. A body that never resolves before the capture stops is recorded as
   * absent, and a failed request keeps `status: 0` — a request that never got an answer is still
   * evidence about the call that was made.
   */
  const onResponse = (response: Response): void => {
    const entry = byRequest.get(response.request());
    if (entry === undefined || stopped) {
      return;
    }
    const { record, roles } = entry;
    record.status = response.status();
    if (!responseCarriesJson(response)) {
      return;
    }
    const context: WalkContext = { roles, runDate, dropAuditBlock: true };
    void response.json().then(
      (payload: unknown) => {
        if (!stopped) {
          record.responseBody = normaliseBody(payload, context);
        }
      },
      () => {
        if (!stopped) {
          record.responseBody = null;
        }
      },
    );
  };

  /** Marks an exchange whose request failed: no status, no body, but a recorded attempt. */
  const onRequestFailed = (request: Request): void => {
    const entry = byRequest.get(request);
    if (entry === undefined || stopped) {
      return;
    }
    entry.record.status = 0;
    entry.record.responseBody = null;
  };

  try {
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);
  } catch {
    // A page closed before the capture started emits nothing more; the session is still usable and
    // writes an empty capture, which is the honest record of a workflow that made no API calls.
  }

  const capture: NormalizedCapture = {
    project,
    workflow,
    runDate: runDate === null ? null : formatRunDate(runDate),
    get exchanges(): readonly NormalizedExchange[] {
      return frozen ?? tracked.map((entry) => entry.record);
    },
    get roles(): RoleMap {
      const merged: { [realId: string]: string } = {};
      // Capture order, first registration wins: the map answers "which token did this id get" for a
      // reader of the file, while the tokens themselves were assigned per exchange (RoleRegistry).
      for (const entry of tracked) {
        for (const registration of entry.roles.entries()) {
          if (!Object.hasOwn(merged, registration.realId)) {
            merged[registration.realId] = registration.token;
          }
        }
      }
      return merged;
    },
  };

  /**
   * Detaches the listeners, freezes the records and answers with the exchanges. Calling it again
   * returns the same array without doing the work twice, and `capture.exchanges` answers with that
   * same array from then on, so a caller may hold either reference.
   */
  function stop(): NormalizedExchange[] {
    if (frozen !== null) {
      return frozen;
    }
    stopped = true;
    try {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    } catch {
      // Detaching from a page that is already gone has nothing left to detach; the records are frozen
      // below either way, so a receiver that stayed attached cannot add to this capture.
    }
    for (const entry of tracked) {
      Object.freeze(entry.record);
    }
    frozen = tracked.map((entry) => entry.record);
    return frozen;
  }

  /**
   * Writes the capture as JSON and answers with the absolute path it wrote, inside
   * `<folder ?? outputDir ?? CAPTURES_DIR>/network/`. A capture that is still running is stopped first,
   * so `write()` and `stop()` may be used in either order. The file name is
   * `<project>__<workflow>.json` — deterministic, so the report writer and the fixture find it without
   * being told, and matching the `<project>__<workflow>` convention of the sibling capture folders.
   */
  function write(folder?: string): string {
    stop();
    const directory = resolve(folder ?? outputDir ?? CAPTURES_DIR, 'network');
    filesystem.mkdirSync(directory, { recursive: true });
    const file = resolve(directory, `${fileNamePart(project)}__${fileNamePart(workflow)}.json`);
    filesystem.writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    return file;
  }

  return { capture, stop, write };
}

/**
 * Whether a response carries a JSON body and is therefore worth reading. Anything else — an empty
 * body, HTML from a proxy, a binary download — is recorded as absent rather than parsed on a guess.
 */
function responseCarriesJson(response: Response): boolean {
  const headers = response.headers();
  const contentType = Object.hasOwn(headers, 'content-type') ? headers['content-type'] : '';
  return contentType.toLowerCase().includes('json');
}

/**
 * A capture's file-name component: the project or workflow id reduced to characters that cannot leave
 * the capture directory, so an id shapes a name but never a path. The ids the harness uses —
 * `legacy`, `next`, `W2`, `CHAIN` — pass through unchanged.
 */
function fileNamePart(value: string | null): string {
  const safe = (value ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe : 'unknown';
}

/** One exchange rendered as a comparable string, for a call that has no counterpart on the other side. */
function summariseExchange(exchange: NormalizedExchange): NormalizedValue {
  return `${exchange.method} ${exchange.path} -> ${exchange.status}`;
}

/** An exchange at a position, or `undefined` past the end, so a length mismatch is a value not a throw. */
function exchangeAt(exchanges: readonly NormalizedExchange[], index: number): NormalizedExchange | undefined {
  return index < exchanges.length ? exchanges[index] : undefined;
}

/** A normalised value as an array, or `null` when it is not one. */
function asArray(value: NormalizedValue): readonly NormalizedValue[] | null {
  return Array.isArray(value) ? value : null;
}

/** A normalised value as an object, or `null` when it is not one. */
function asObject(value: NormalizedValue): { [key: string]: NormalizedValue } | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  return null;
}

/** A record's field as a comparable value: `null` when the field is absent on that side. */
function fieldValue(record: { [key: string]: NormalizedValue }, key: string): NormalizedValue {
  return Object.hasOwn(record, key) ? record[key] : null;
}

/** An array's element, or `null` past the end, so arrays of different lengths compare element by element. */
function elementAt(values: readonly NormalizedValue[], index: number): NormalizedValue {
  return index < values.length ? values[index] : null;
}

/**
 * Compares two normalised values and reports every leaf that differs. Object keys are already sorted
 * by normalisation, so key order cannot produce a false difference; array order is significant and is
 * compared position by position. A shape that changes between the sides — an object where the other
 * has an array, or a scalar — is one difference at that node, because the calls diverged there and the
 * leaves below it have no counterpart to compare.
 */
function compareValues(
  field: string,
  legacy: NormalizedValue,
  next: NormalizedValue,
  report: (field: string, legacy: NormalizedValue, next: NormalizedValue) => void,
): void {
  const legacyItems = asArray(legacy);
  const nextItems = asArray(next);
  if (legacyItems !== null && nextItems !== null) {
    for (let index = 0; index < Math.max(legacyItems.length, nextItems.length); index += 1) {
      compareValues(`${field}[${index}]`, elementAt(legacyItems, index), elementAt(nextItems, index), report);
    }
    return;
  }
  const legacyFields = asObject(legacy);
  const nextFields = asObject(next);
  if (legacyFields !== null && nextFields !== null) {
    const keys = [...new Set([...Object.keys(legacyFields), ...Object.keys(nextFields)])].sort();
    for (const key of keys) {
      compareValues(`${field}.${key}`, fieldValue(legacyFields, key), fieldValue(nextFields, key), report);
    }
    return;
  }
  if (legacy !== next) {
    report(field, legacy, next);
  }
}

/**
 * Compares two normalised captures call by call, in the order the pages issued them: AAP 0.10.1 makes
 * the ordered API calls the criterion, so exchanges pair by position and are never matched by content.
 * An empty result is parity.
 *
 * `origin` is not compared. The host is a hard gate — `e2e/fixtures/parity-fixture.ts` fails a run
 * whose `/fineract-provider/` traffic left `FINERACT_URL` (Rule 2) — and restating that here would
 * bury a backend misconfiguration inside a request diff a reader would take for a behavioural
 * difference.
 *
 * Nothing here throws: an input the comparison cannot walk is reported as a difference at the node
 * where it stops making sense, because a comparison the harness could not complete is a finding in its
 * own right.
 *
 * @param legacy Normalised exchanges of the legacy baseline.
 * @param next Normalised exchanges of the new application.
 * @returns One entry per difference, ordered by exchange and by field; empty when the two agree.
 */
export function diffExchanges(
  legacy: readonly NormalizedExchange[],
  next: readonly NormalizedExchange[],
): ExchangeDiff[] {
  const differences: ExchangeDiff[] = [];
  for (let index = 0; index < Math.max(legacy.length, next.length); index += 1) {
    const legacyExchange = exchangeAt(legacy, index);
    const nextExchange = exchangeAt(next, index);
    if (legacyExchange === undefined || nextExchange === undefined) {
      const present = legacyExchange ?? nextExchange;
      differences.push({
        index,
        method: present === undefined ? '' : present.method,
        path: present === undefined ? '' : present.path,
        field: 'exchange',
        legacy: legacyExchange === undefined ? null : summariseExchange(legacyExchange),
        next: nextExchange === undefined ? null : summariseExchange(nextExchange),
      });
      continue;
    }
    const anchor = { index, method: legacyExchange.method, path: legacyExchange.path };
    const report = (field: string, legacyValue: NormalizedValue, nextValue: NormalizedValue): void => {
      differences.push({ ...anchor, field, legacy: legacyValue, next: nextValue });
    };
    if (legacyExchange.method !== nextExchange.method) {
      report('method', legacyExchange.method, nextExchange.method);
    }
    if (legacyExchange.path !== nextExchange.path) {
      report('path', legacyExchange.path, nextExchange.path);
    }
    if (legacyExchange.status !== nextExchange.status) {
      report('status', legacyExchange.status, nextExchange.status);
    }
    if (legacyExchange.hasTenantHeader !== nextExchange.hasTenantHeader) {
      report('hasTenantHeader', legacyExchange.hasTenantHeader, nextExchange.hasTenantHeader);
    }
    if (legacyExchange.hasAuthorizationHeader !== nextExchange.hasAuthorizationHeader) {
      report('hasAuthorizationHeader', legacyExchange.hasAuthorizationHeader, nextExchange.hasAuthorizationHeader);
    }
    const queryKeys = [...new Set([...Object.keys(legacyExchange.query), ...Object.keys(nextExchange.query)])].sort();
    for (const key of queryKeys) {
      const legacyValue = fieldValue(legacyExchange.query, key);
      const nextValue = fieldValue(nextExchange.query, key);
      if (legacyValue !== nextValue) {
        report(`query.${key}`, legacyValue, nextValue);
      }
    }
    compareValues('requestBody', legacyExchange.requestBody, nextExchange.requestBody, report);
    compareValues('responseBody', legacyExchange.responseBody, nextExchange.responseBody, report);
  }
  return differences;
}

