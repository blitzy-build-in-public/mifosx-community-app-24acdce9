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
 * booleans and a body field named for a credential or a session becomes {@link MASKED}. The module
 * keeps no credential in a variable, writes none to a message and holds no logger.
 *
 * A response body arrives as a promise, so a capture that serialised only what had already resolved
 * would lose the body of the last call a workflow made. Teardown is therefore two steps:
 * {@link CaptureSession.stop} detaches the listeners and answers with the exchanges as they stand,
 * while {@link CaptureSession.settle} — which {@link CaptureSession.write} awaits — waits for every body
 * read still in flight before it freezes the records. Either route then carries the bodies of the calls
 * it recorded, which is what AAP 0.10.1 compares.
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
 * 2. **Masking** — `Authorization` and tenant headers are reduced to presence booleans; a body field
 *    whose name says credential or session material becomes {@link MASKED}, while a boolean flag that
 *    merely contains such a word is compared as it stands; a request body that is not JSON becomes a
 *    fixed marker.
 * 3. **Path templating** — numeric segments become role tokens: `/clients/123` → `/clients/{clientId}`.
 * 4. **Body ids** — a numeric value under a key the run generates an id for becomes the role token of
 *    that id, so a generated id is compared by its role and its sequence, never by its value. Every
 *    reference id — office, product, staff, payment type, a `status` or `loanType` object — is compared
 *    by value, because the two front ends choosing differently is a difference the gate must report.
 * 5. **Dates** — a `…date` value becomes a day offset from the run date, in either shape Fineract
 *    reports one in: `21 November 2026` and `[2026, 11, 21]` on a run date of the same day both become
 *    `d0` (AAP 0.10.2, "Dates"; AAP 0.10.1, "Run date").
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

import { dayOffset, formatDateOnly, parseFineractDate } from '../seed/fixtures';

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
 * How long {@link CaptureSession.settle} waits for one round of response body reads that are still in
 * flight. Generous for a payload the browser is still handing over, and short enough that a body the
 * page will never deliver cannot hold a workflow's teardown open: an exchange whose read has not settled
 * by then keeps `responseBody: null`, which is the same record a failed read leaves.
 */
const BODY_SETTLE_TIMEOUT_MS = 5000;

/**
 * Body fields that carry a credential or session material (Rule 1 clause 9): the `password` the login
 * form sends, the `base64EncodedAuthenticationKey` the authentication response returns (AAP 0.7.2
 * `AuthResponse`), and the credential- and session-shaped names a forked or extended payload could
 * carry — `passcode`, `token`, `secret`, `session`, `authorization`, `apiKey`, `credential`, with `pass`
 * and `pin` covered as whole names only. Masking is by name because a body is otherwise unmodelled, so
 * a session-bearing field cannot reach a record, a diff or a file under any of them (AAP 0.10.2,
 * "Session and auth material"). A boolean flag whose name merely contains one of these words is
 * compared instead, because a flag is not a secret: {@link normaliseValue} answers booleans first.
 */
const SECRET_KEY_PATTERN =
  /password|passcode|^pass$|^pin$|token|secret|session|authorization|authenticationKey|apiKey|credential/i;

/**
 * Body keys whose id a run generates: the ids AAP 0.10.2 compares by their role in the sequence rather
 * than by their literal value, because each front end creates its own record and so sees its own
 * number for the same step.
 *
 * An allowlist rather than an `id`/`…Id` pattern, because the two possible mistakes are not equally
 * visible. A reference id — `officeId`, `productId`, `staffId`, `paymentTypeId`, the `id` of a
 * `status`/`loanType`/`documentType` object — normalised to a role token makes a real difference
 * between the two front ends vanish from the diff: a false pass, which nothing downstream re-checks
 * and criterion 4 cannot detect. An id that belongs here but is compared by value only adds a loud
 * difference to a report a human already reads. So the list names what the run creates and nothing
 * else; every other id is compared by value.
 */
const GENERATED_ID_KEYS: ReadonlySet<string> = new Set<string>([
  'clientId',
  'loanId',
  'savingsId',
  'savingsAccountId',
  'accountId',
  'transactionId',
  'chargeId',
  'identifierId',
  'resourceId',
]);

/**
 * Entity nouns whose bare `id` a run generates: in `{ client: { id: 7 } }` the id is the client the
 * run created, so it takes a role token as a `clientId` does. A noun outside this list is a reference
 * object — `status`, `documentType`, `loanType`, `amortizationType` — whose id both front ends must
 * choose identically and which is therefore compared by value.
 */
const GENERATED_ENTITY_NOUNS: readonly string[] = [
  'client',
  'loan',
  'loanAccount',
  'savings',
  'savingsAccount',
  'account',
  'transaction',
  'charge',
  'identifier',
  'resource',
];

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
 * The file-name component of a capture artefact: the project or workflow id reduced to characters that
 * cannot leave the capture directory, so an id shapes a name but never a path. The ids the harness uses
 * — `legacy`, `next`, `W2`, `CHAIN` — pass through unchanged.
 *
 * Exported because `capture/state-snapshot.ts` writes its snapshot beside this module's capture under
 * the same `<project>__<workflow>.json` convention (AAP 0.8.1), and two definitions of the sanitiser
 * would be free to drift apart. Surrounding whitespace is trimmed first, so an id that reached the
 * harness through configuration still names the same file either writer would produce.
 *
 * @param value Project or workflow id, or `null` when the capture carried none.
 */
export function fileNamePart(value: string | null): string {
  const safe = (value ?? 'unknown').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe : 'unknown';
}

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
 * the other: `write()` awaits {@link CaptureSession.settle}, so the file carries every body the page
 * had already fetched however little the caller waited first. */
export interface CaptureSession {
  /** The capture being built; its `exchanges` fills as the page makes calls and `roles` answers for
   * whatever has been recorded so far. */
  readonly capture: NormalizedCapture;
  /** Detaches the page listeners and returns the exchanges as they stand, without freezing them: a
   * response body this capture is still reading is the capture's own work, not a caller mutation, so it
   * may still land. A caller that needs every body uses {@link CaptureSession.settle} or
   * {@link CaptureSession.write}. Idempotent. */
  stop(): NormalizedExchange[];
  /** Detaches the page listeners, waits for every response body read still in flight, then freezes the
   * records and returns the exchanges. Idempotent, and the array it answers with is the one `stop()`
   * returned. */
  settle(): Promise<NormalizedExchange[]>;
  /** Writes the capture as JSON, once every response body has settled, and resolves with the absolute
   * path of the file it wrote. */
  write(folder?: string): Promise<string>;
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
 * The plural noun as a singular one, for a collection {@link ROLE_NAMES} does not name and for the
 * body keys {@link generatedIdRole} reads: `reports` becomes `report`, while a noun that is already
 * singular — or that merely ends in `us` or `ss`, as `status` and `address` do — is left alone.
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
 * The role a body id belongs to, or `null` when that id is a reference the comparison must keep by
 * value.
 *
 * A named generated id answers its own key (`clientId`); a bare `id` answers `id` at the top of a body
 * — the shape Fineract uses for a bare record — and the enclosing noun's role when that noun is one the
 * run creates, so `{ client: { id: 7 } }` reads `{clientId}`. A collection key is matched as it stands
 * as well as singularised, because {@link singularise} turns the already-singular `savings` into
 * `saving`.
 */
function generatedIdRole(key: string, parentKey: string): string | null {
  if (GENERATED_ID_KEYS.has(key)) {
    return key;
  }
  if (key !== 'id') {
    return null;
  }
  if (parentKey.length === 0) {
    return 'id';
  }
  const noun = singularise(parentKey).toLowerCase();
  const known = GENERATED_ENTITY_NOUNS.find(
    (entity) => entity.toLowerCase() === noun || entity.toLowerCase() === parentKey.toLowerCase(),
  );
  return known === undefined ? null : `${known}Id`;
}

/**
 * Normalises one JSON value: masks a field whose name says credential or session material but compares
 * a boolean flag as it stands, turns a payload date under a date-named key into a day offset,
 * canonicalises key order, turns an id into a role token and drops the audit block, in the single pass
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
  if (typeof value === 'boolean') {
    // A boolean carries no credential and no session material, so a flag whose name merely contains a
    // secret word — `shouldRenewPassword`, `isTwoFactorAuthenticationRequired` (AAP 0.7.2,
    // `AuthResponse`) — is compared rather than masked. Masking it would erase real parity signal for
    // no security gain: nothing about a `true`/`false` could leak a secret.
    return value;
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return MASKED;
  }
  if (value === null) {
    return null;
  }
  if (context.runDate !== null && DATE_KEY_PATTERN.test(key)) {
    // Dates are read before the shape branches because Fineract reports one date two ways: as the
    // payload text form `dd MMMM yyyy` and as a `[year, month, day]` triple (AAP 0.7.2; AAP 0.10.2,
    // "Dates"). Both reduce to the day offset built from the run date, so a run that spans two
    // business dates still compares equal; a `…date` value in any other shape falls through to the
    // branches below and is kept as it stands.
    const parsedDate = parseFineractDate(value);
    if (parsedDate !== null) {
      return dateOffsetToken(parsedDate, context.runDate);
    }
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
  // JSON cannot carry anything else, and `undefined` is how a key that must not appear is expressed.
  return undefined;
}

/**
 * Normalises a string field: a numeric value under a key the run generates an id for becomes a role
 * token, and everything else — a reference id, `dateFormat` and `locale`, whose values AAP 0.10.2
 * compares verbatim, and a `…date` value in a shape {@link parseFineractDate} does not read — is kept
 * as it stands.
 */
function normaliseText(value: string, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  const role = generatedIdRole(key, parentKey);
  if (role !== null && /^\d+$/.test(value)) {
    return context.roles.token(role, value);
  }
  return value;
}

/**
 * Normalises a number field: an integer under a key the run generates an id for becomes a role token,
 * and every other number — a reference id included, since two front ends sending different payment
 * types or offices is exactly the difference the diff must report — is compared by its value.
 */
function normaliseNumber(value: number, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  const role = generatedIdRole(key, parentKey);
  if (role !== null && Number.isInteger(value) && value >= 0) {
    return context.roles.token(role, String(value));
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

/** One exchange while it is being filled; frozen and handed out as a {@link NormalizedExchange} once
 * {@link CaptureSession.settle} has waited for its body and frozen the records. */
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
  /** Every response body read this capture has started and not yet seen settle. {@link settle} waits for
   * them, so a body that arrives once the listeners are detached still reaches the record it belongs to
   * instead of dropping out of the comparison (AAP 0.10.1 compares the ordered calls with their bodies). */
  const pendingBodies = new Set<Promise<void>>();
  let stopped = false;
  /** The exchanges in record order, built once so `stop()` answers with the same array however often it
   * is called and `capture.exchanges` agrees with it afterwards. */
  let collected: NormalizedExchange[] | null = null;
  /** Whether the records have been frozen. A body read that settles afterwards is skipped rather than
   * assigned to a frozen record, which strict mode would throw on. */
  let frozen = false;

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
   * Reads one response body into the exchange its request created, and keeps the read in
   * {@link pendingBodies} until it settles so {@link settle} can wait for it.
   *
   * The read is the capture's own work rather than a caller's mutation, so its callbacks are gated on
   * the records not being frozen yet and not on the listeners being detached: a body that arrives after
   * `stop()` still lands, and one that arrives after the freeze is skipped instead of being assigned to
   * a frozen record. Neither callback rejects, so the set always drains.
   */
  const readBody = (entry: TrackedExchange, response: Response): void => {
    const context: WalkContext = { roles: entry.roles, runDate, dropAuditBlock: true };
    const read: Promise<void> = response.json().then(
      (payload: unknown) => {
        if (!frozen) {
          entry.record.responseBody = normaliseBody(payload, context);
        }
      },
      () => {
        if (!frozen) {
          entry.record.responseBody = null;
        }
      },
    );
    pendingBodies.add(read);
    const forget = (): void => {
      pendingBodies.delete(read);
    };
    void read.then(forget, forget);
  };

  /**
   * Attaches a response to the exchange its request created, and starts reading its body when that body
   * is JSON. A failed request keeps `status: 0` — a request that never got an answer is still evidence
   * about the call that was made — and a body still unread when {@link settle} has waited long enough
   * is recorded as absent rather than guessed at.
   */
  const onResponse = (response: Response): void => {
    const entry = byRequest.get(response.request());
    if (entry === undefined || stopped) {
      return;
    }
    entry.record.status = response.status();
    if (!responseCarriesJson(response)) {
      return;
    }
    readBody(entry, response);
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
    runDate: runDate === null ? null : formatDateOnly(runDate),
    get exchanges(): readonly NormalizedExchange[] {
      return collected ?? tracked.map((entry) => entry.record);
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

  /** The exchanges in record order, built once and handed out unchanged afterwards, so `stop()` and
   * `settle()` answer with one array and `capture.exchanges` agrees with both. */
  function exchanges(): NormalizedExchange[] {
    collected ??= tracked.map((entry) => entry.record);
    return collected;
  }

  /**
   * Detaches the three page listeners and refuses any further record. Idempotent, and it tolerates a
   * page that is already gone — a closed page has nothing left to detach and, `stopped` being set first,
   * cannot add to this capture either way.
   *
   * Detaching stops new records from arriving and leaves the records already held writable, because a
   * body read this capture started is the capture's own work rather than a caller mutation.
   */
  function detach(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    } catch {
      // Detaching from a page that is already gone has nothing left to detach; `stopped` above still
      // keeps a receiver that stayed attached from adding to this capture.
    }
  }

  /**
   * Freezes every record, once, and answers with the exchanges. Freezing is what makes a record a
   * {@link NormalizedExchange} a caller may hold: from then on a body read that settles late is skipped
   * rather than written into a frozen record. Calling it again returns the same array without doing the
   * work twice, and `capture.exchanges` answers with that array from then on, so a caller may hold
   * either reference.
   */
  function freezeRecords(): NormalizedExchange[] {
    const list = exchanges();
    if (!frozen) {
      frozen = true;
      for (const entry of tracked) {
        Object.freeze(entry.record);
      }
    }
    return list;
  }

  /**
   * Detaches the listeners and answers with the exchanges as they stand. Idempotent, and the same array
   * comes back however often it is called.
   *
   * It neither freezes the records nor waits for a response body still in flight: a body this capture
   * started reading is the capture's own work, so it is still allowed to land after teardown. A caller
   * that needs every body must use {@link settle} or {@link write}.
   */
  function stop(): NormalizedExchange[] {
    detach();
    return exchanges();
  }

  /**
   * Detaches the listeners, waits for every response body read still in flight, then freezes the records
   * and answers with the exchanges. Idempotent, and the array is the one {@link stop} returned.
   *
   * Waiting is what keeps the comparison honest: AAP 0.10.1 compares the ordered API calls including
   * their bodies, so a body that never settled must not silently vanish from it. {@link readsSettled}
   * bounds the wait, so a body the page will never deliver cannot hold teardown open for ever.
   */
  async function settle(): Promise<NormalizedExchange[]> {
    detach();
    while (pendingBodies.size > 0) {
      // A whole round is awaited at once and the loop repeats, because a read that settles may leave
      // another one behind it in the set.
      if (!(await readsSettled([...pendingBodies]))) {
        break;
      }
    }
    return freezeRecords();
  }

  /**
   * Writes the capture as JSON and resolves with the absolute path it wrote, inside
   * `<folder ?? outputDir ?? CAPTURES_DIR>/network/`.
   *
   * {@link settle} runs first, so a capture that is still running is stopped, its bodies are read and
   * its records frozen before anything is serialised: `write()` and `stop()` may be used in either
   * order, and the file carries every body either way. The file name is `<project>__<workflow>.json` —
   * deterministic, so the report writer and the fixture find it without being told, and matching the
   * `<project>__<workflow>` convention of the sibling capture folders.
   */
  async function write(folder?: string): Promise<string> {
    await settle();
    const directory = resolve(folder ?? outputDir ?? CAPTURES_DIR, 'network');
    filesystem.mkdirSync(directory, { recursive: true });
    const file = resolve(directory, `${fileNamePart(project)}__${fileNamePart(workflow)}.json`);
    filesystem.writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    return file;
  }

  return { capture, stop, settle, write };
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
 * Waits for one round of response body reads, giving up after {@link BODY_SETTLE_TIMEOUT_MS} so a read
 * the browser will never finish cannot keep {@link CaptureSession.settle} waiting for ever.
 *
 * @param reads Body reads to wait for; the caller has already taken them out of its pending set.
 * @returns `true` once every read settled, `false` when the wait timed out first.
 */
async function readsSettled(reads: readonly Promise<void>[]): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolveExpiry) => {
    timer = setTimeout(() => resolveExpiry(false), BODY_SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.all(reads).then(() => true), expired]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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

