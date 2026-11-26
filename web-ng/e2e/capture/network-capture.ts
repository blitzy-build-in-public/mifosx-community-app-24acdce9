/** Playwright traffic recorder for the parity suite: records every Fineract API exchange one workflow on one front end makes, normalises it per AAP 0.10.2, and diffs two captures (AAP 0.10.1) (Rule 1 clause 9). */
import * as filesystem from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Request, Response } from '@playwright/test';

import { dayOffset, formatDateOnly, parseFineractDate } from '../seed/fixtures';

export const MASKED = '***';
/** Extensions of files a page fetches to render: AAP 0.10.2 excludes static assets from the comparison and from the fixture's host assertion, so both sides read this one list via {@link isStaticAssetUrl}. */
export const STATIC_ASSET_EXTENSIONS: readonly string[] = [
  'js', 'css', 'map', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot',
];
/** Path prefixes served as static assets without an extension: the built app's `assets/` and the legacy translations the new app loads in place (AAP 0.4.4). */
const STATIC_PATH_PREFIXES: readonly string[] = ['/assets/', '/global-translations/'];
/** The prefix every Fineract API call carries (AAP 0.7.3), held as a pattern so this module carries no API-shaped literal an endpoint scan would have to exempt. */
const API_PATH_PREFIX = /^\/fineract-provider\//;
/** The tenant header's name — the API contract's constant, not tenant data: only its presence is kept, as `hasTenantHeader` (Rule 1 clause 9, AAP 0.4.2). */
const TENANT_HEADER_NAME = 'Fineract-Platform-TenantId';
/** The credential header, compared by lowercase name because `Request.headers()` lower-cases keys. */
const AUTHORIZATION_HEADER_NAME = 'authorization';
/** Stands in for a request body that is not JSON, which cannot be masked field by field and so is never stored (Rule 1 clause 9). */
const NON_JSON_BODY = '<non-json body>';
/** How long {@link CaptureSession.settle} waits for one round of in-flight body reads; an exchange unsettled by then keeps `responseBody: null`, as a failed read leaves it. */
const BODY_SETTLE_TIMEOUT_MS = 5000;
/** Body fields masked by name for Rule 1 clause 9: `password`, `base64EncodedAuthenticationKey` (AAP 0.7.2 `AuthResponse`), and the credential- or session-shaped `passcode`, `token`, `secret`, `session`, `authorization`, `apiKey`, `credential`, with `pass` and `pin` whole names only — so no session-bearing field reaches a record, a diff or a file (AAP 0.10.2), while a boolean flag that merely contains one of these words is compared as it stands. */
const SECRET_KEY_PATTERN =
  /password|passcode|^pass$|^pin$|token|secret|session|authorization|authenticationKey|apiKey|credential/i;
/** Body keys whose id a run generates, which AAP 0.10.2 therefore compares by role in the sequence, not by value; an allowlist, because roling a reference id (`officeId`, `productId`, `status.id`) would hide a real difference between the front ends. */
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
/** Entity nouns whose bare `id` a run generates, so `{ client: { id: 7 } }` reads `{clientId}`; a noun outside this list (`status`, `documentType`, `loanType`) is a reference compared by value. */
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
/** A key naming a date (`submittedOnDate`, `dueDate`, and `dateOfBirth`, word first), matched as prefix, suffix or after a separator; {@link parseFineractDate} then decides whether the value is a date, which keeps `dateFormat` verbatim. */
const DATE_KEY_PATTERN = /(^|_|\b)date|date$/i;
/** Fineract's server-side audit block: AAP 0.10.2 drops the `timestamps` subtree, whose `[year, month, day]` arrays no workflow asserts. */
const AUDIT_BLOCK_KEY = 'timestamps';
/** Request kinds that can carry an API call; a `document` request is a page load, never an API call. */
const API_RESOURCE_TYPES: readonly string[] = ['fetch', 'xhr'];
/** Absolute `web-ng/e2e/.captures` — gitignored, resolved from this file so every launch writes the same place, and imported by `capture/state-snapshot.ts` (AAP 0.8.1, 0.11.1). */
export const CAPTURES_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.captures');
/** The file-name part of an artefact id: trimmed, with everything outside `[A-Za-z0-9._-]` replaced by `_`, so an id shapes a name but never a path; shared with `capture/state-snapshot.ts` under one `<project>__<workflow>.json` convention. */
export function fileNamePart(value: string | null): string {
  const safe = (value ?? 'unknown').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe : 'unknown';
}
/** A JSON-shaped value after {@link normaliseValue}: every scalar a Fineract payload carries, and the arrays and objects built from them, so a record always serialises. */
export type NormalizedValue =
  | string
  | number
  | boolean
  | null
  | NormalizedValue[]
  | { [key: string]: NormalizedValue };
/** One Fineract API exchange normalised as AAP 0.10.2 requires: no headers (only their presence), no timestamps, no generated ids, no query ordering. */
export interface NormalizedExchange {
  readonly method: string;
  /** Origin the call went to, e.g. `https://localhost:8443`: the parity fixture proves the run never left the configured backend (Rule 2), and {@link diffExchanges} does not compare it. */
  readonly origin: string;
  /** Pathname with numeric segments templated by role, e.g. `/fineract-provider/api/v1/clients/{clientId}`. */
  readonly path: string;
  /** Query parameters with keys sorted ascending, a repeated key's values joined with `,`, and a credential- or session-named key's value {@link MASKED} (Rule 1 clause 9). */
  readonly query: Readonly<Record<string, string>>;
  /** HTTP status, or `0` when no response arrived (a failed request is still evidence). */
  readonly status: number;
  readonly hasTenantHeader: boolean;
  /** Whether the credential header was present. Its value is never recorded (Rule 1 clause 9). */
  readonly hasAuthorizationHeader: boolean;
  readonly requestBody: NormalizedValue | null;
  readonly responseBody: NormalizedValue | null;
}
/** The tokens one capture's generated ids were mapped to: the real id as a string to the role token it became, e.g. `'123' -> '{clientId}'` (AAP 0.10.2, ids compared by role). */
export interface RoleMap {
  readonly [realId: string]: string;
}
export interface NormalizedCapture {
  readonly project: string | null;
  /** Workflow id the capture covers, e.g. `W2` or `CHAIN`, `null` when unset. */
  readonly workflow: string | null;
  readonly runDate: string | null;
  /** Exchanges in the order the page issued them — the order AAP 0.10.1 compares. */
  readonly exchanges: readonly NormalizedExchange[];
  readonly roles: RoleMap;
}
export interface CaptureOptions {
  project?: 'legacy' | 'next';
  /** Workflow id the capture covers, e.g. `'W2'` or `'CHAIN'`. */
  workflow?: string;
  /** The tenant's business date read from Fineract (AAP 0.10.1), never the browser clock; payload dates become offsets from it, and without it they stay verbatim. */
  runDate?: Date;
  outputDir?: string;
}
/** A running capture: `stop()` and `write()` may be called in either order, and `write()` awaits {@link CaptureSession.settle} so the file carries every body the page had fetched. */
export interface CaptureSession {
  readonly capture: NormalizedCapture;
  stop(): NormalizedExchange[];
  /** Detaches the listeners, waits for every in-flight response body read, then freezes the records and answers with the exchanges; idempotent, and the array is the one `stop()` returned. */
  settle(): Promise<NormalizedExchange[]>;
  write(folder?: string): Promise<string>;
}
/** One difference between two captures, anchored to the exchange it occurred in — by position, method and path, because AAP 0.10.2 compares the ordered API calls. */
export interface ExchangeDiff {
  readonly index: number;
  readonly method: string;
  readonly path: string;
  /** What differs, as a value path: `method`, `path`, `query.command`, `status`, `hasTenantHeader`, `hasAuthorizationHeader`, `requestBody.principal`, `responseBody.errors[0].defaultUserMessage`, or `exchange`. */
  readonly field: string;
  readonly legacy: NormalizedValue;
  readonly next: NormalizedValue;
}
/** Whether a URL addresses a static asset rather than an API call — AAP 0.10.2 excludes them and the fixture's host assertion reads this same definition; an unparseable URL answers `false` instead of throwing. */
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
class RoleRegistry {
  private readonly tokens = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly order: { readonly realId: string; readonly token: string }[] = [];
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
  entries(): readonly { readonly realId: string; readonly token: string }[] {
    return this.order;
  }
}
/** Role names for the collections the harness meets, keyed by path segment: AAP 0.7.3 spells collections in lower case and Fineract models ids in camel case, which keeps `{savingsAccountId}` from becoming `{savingsaccountId}`. */
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
function singularise(noun: string): string {
  if (noun.endsWith('ies') && noun.length > 3) {
    return `${noun.slice(0, -3)}y`;
  }
  if (noun.endsWith('ss') || noun.endsWith('us')) {
    return noun;
  }
  return noun.endsWith('s') && noun.length > 1 ? noun.slice(0, -1) : noun;
}
function roleForSegment(segments: readonly string[], position: number): string {
  const parent: string | undefined = position > 0 ? segments[position - 1] : undefined;
  if (parent === undefined || parent.length === 0 || /^\d+$/.test(parent)) {
    return 'id';
  }
  const named = ROLE_NAMES.get(parent);
  return named ?? `${singularise(parent)}Id`;
}
/** Templates an id-carrying path by role, registering each id in its exchange's registry, so a path compares as `/clients/{clientId}` whichever client the run created (AAP 0.10.2). */
function normalisePath(pathname: string, roles: RoleRegistry): string {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const templated = segments.map((segment, position) =>
    /^\d+$/.test(segment) ? roles.token(roleForSegment(segments, position), segment) : segment,
  );
  return `/${templated.join('/')}`;
}
/** The query parameters of one call: keys sorted, a repeated key's own values joined with `,` in their order, `command` kept because it separates Fineract's action endpoints (AAP 0.7.3), and a credential- or session-named value {@link MASKED} (Rule 1 clause 9). */
function normaliseQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of [...new Set(url.searchParams.keys())].sort()) {
    query[key] = SECRET_KEY_PATTERN.test(key) ? MASKED : url.searchParams.getAll(key).join(',');
  }
  return query;
}
/** Whether a header is present, compared case-insensitively because header names are not case-sensitive; only presence leaves, since the two headers asked about carry a credential and tenant data (Rule 1 clause 9, AAP 0.4.2). */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === wanted);
}
/** A date as a day offset from the run date — `d0`, `d+1`, `d-2` — so a capture taken on another business date still compares equal (AAP 0.10.2); the arithmetic is `dayOffset()` in `../seed/fixtures`. */
function dateOffsetToken(date: Date, runDate: Date): string {
  const offset = dayOffset(runDate, date);
  if (offset === 0) {
    return 'd0';
  }
  return offset > 0 ? `d+${offset}` : `d${offset}`;
}
interface WalkContext {
  readonly roles: RoleRegistry;
  readonly runDate: Date | null;
  readonly dropAuditBlock: boolean;
}
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The role a body id belongs to, or `null` when it is a reference the comparison keeps by value: a named generated key answers its own key, and a bare `id` answers `id` at the top of a body or the role of its enclosing created noun. */
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
/** Normalises one JSON value in a single pass: masks a credential- or session-named field while comparing a boolean flag as it stands, turns a date under a date-named key into a day offset, sorts keys, roles a generated id and drops the audit block (AAP 0.10.2). Each `unknown` here is an unmodelled Fineract payload — the documented boundary Rule 1 clause 4 permits, since masking (Rule 1 clause 9) must not be able to miss a field. */
function normaliseValue(
  value: unknown,
  context: WalkContext,
  key: string,
  parentKey: string,
): NormalizedValue | undefined {
  if (typeof value === 'boolean') {
    // A boolean carries no credential and no session material, so a flag whose name merely contains a secret word — `shouldRenewPassword`, `isTwoFactorAuthenticationRequired` (AAP 0.7.2, `AuthResponse`) — is compared rather than masked: nothing about a `true`/`false` could leak a secret.
    return value;
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return MASKED;
  }
  if (value === null) {
    return null;
  }
  if (context.runDate !== null && DATE_KEY_PATTERN.test(key)) {
    // Dates are read before the shape branches because Fineract reports one date two ways — the payload text form `dd MMMM yyyy` and a `[year, month, day]` triple (AAP 0.7.2; AAP 0.10.2, "Dates") — and both reduce to the day offset built from the run date, so a run that spans two business dates still compares equal; a value under a date-named key that is not a date, a `dateFormat` say, falls through to the branches below and is kept as it stands.
    const parsedDate = parseFineractDate(value);
    if (parsedDate !== null) {
      return dateOffsetToken(parsedDate, context.runDate);
    }
  }
  if (Array.isArray(value)) {
    // Arrays keep their order, because repayment-schedule periods, transactions and charges are ordered data (AAP 0.10.2); an element sits under the same key as its array, so the role context is unchanged.
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
/** Normalises a string field: a numeric value under a generated-id key becomes a role token; everything else stays verbatim, `dateFormat` and `locale` included (AAP 0.10.2). */
function normaliseText(value: string, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  const role = generatedIdRole(key, parentKey);
  if (role !== null && /^\d+$/.test(value)) {
    return context.roles.token(role, value);
  }
  return value;
}
function normaliseNumber(value: number, context: WalkContext, key: string, parentKey: string): NormalizedValue {
  const role = generatedIdRole(key, parentKey);
  if (role !== null && Number.isInteger(value) && value >= 0) {
    return context.roles.token(role, String(value));
  }
  return value;
}
/** A whole body after normalisation, or `null` when there is none or nothing survives it, so no body and an empty body stay distinguishable. */
function normaliseBody(payload: unknown, context: WalkContext): NormalizedValue | null {
  return normaliseValue(payload, context, '', '') ?? null;
}
/** The request body of one exchange, masked and normalised, or `null`; a body that is not JSON is never stored and {@link NON_JSON_BODY} stands in for it (Rule 1 clause 9). */
function readRequestBody(request: Request, context: WalkContext): NormalizedValue | null {
  let raw: string | null;
  try {
    raw = request.postData();
  } catch {
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
interface TrackedExchange {
  readonly record: MutableExchange;
  readonly roles: RoleRegistry;
}
function requireRunDate(date: Date): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      'startCapture() needs a valid run date; pass the tenant business date read from Fineract ' +
        '(AAP 0.10.1), never the browser clock.',
    );
  }
  return new Date(date.getTime());
}
/** Starts recording one page's Fineract API exchanges: the listeners attach to a page the caller already drives, and a page that was already closed records none and still writes; an invalid `options.runDate` throws (see {@link requireRunDate}). */
export function startCapture(page: Page, options: CaptureOptions = {}): CaptureSession {
  const project = options.project ?? null;
  const workflow = options.workflow ?? null;
  const runDate = options.runDate === undefined ? null : requireRunDate(options.runDate);
  const outputDir = options.outputDir;

  const tracked: TrackedExchange[] = [];
  const byRequest = new Map<Request, TrackedExchange>();
  /** Every response body read this capture started and has not seen settle: {@link settle} waits for them, so a body arriving after the listeners detach still reaches its record (AAP 0.10.1 compares the calls with their bodies). */
  const pendingBodies = new Set<Promise<void>>();
  let stopped = false;
  /** The exchanges in record order, built once, so `stop()` answers with the same array however often it is called and `capture.exchanges` agrees with it. */
  let collected: NormalizedExchange[] | null = null;
  let frozen = false;
  /** Records one request: only a Fineract API call becomes an exchange, so the document, the legacy `views/**` partials, translations, images and fonts are dropped (AAP 0.10.1 compares the ordered API calls). */
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
      // `headers()` is the synchronous view of the headers the browser actually sent: it omits cookie-related headers only, so both headers that matter here are visible, because the front ends set them from JavaScript on every call.
      headers = request.headers();
    } catch {
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
  /** Attaches a response to the exchange its request created and starts reading a JSON body: a request that never got an answer keeps `status: 0`, and a body still unread after the wait is recorded as absent rather than guessed. */
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
    // A page closed before the capture started emits nothing more; the session is still usable and writes an empty capture, which is the honest record of a workflow that made no API calls.
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
  function exchanges(): NormalizedExchange[] {
    collected ??= tracked.map((entry) => entry.record);
    return collected;
  }
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
      // Detaching from a page that is already gone has nothing left to detach; `stopped` above still keeps a receiver that stayed attached from adding to this capture.
    }
  }
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
  function stop(): NormalizedExchange[] {
    detach();
    return exchanges();
  }
  /** Detaches the listeners, waits for every in-flight body read — bounded by {@link readsSettled} — freezes the records and answers with the exchanges, because AAP 0.10.1 compares the ordered calls including bodies a page must not silently drop. */
  async function settle(): Promise<NormalizedExchange[]> {
    detach();
    while (pendingBodies.size > 0) {
      if (!(await readsSettled([...pendingBodies]))) {
        break;
      }
    }
    return freezeRecords();
  }
  /** Writes the capture as JSON to `<folder ?? outputDir ?? CAPTURES_DIR>/network/<project>__<workflow>.json` and resolves with that path, after {@link settle}, so `write()` and `stop()` may be used in either order. */
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
function responseCarriesJson(response: Response): boolean {
  const headers = response.headers();
  const contentType = Object.hasOwn(headers, 'content-type') ? headers['content-type'] : '';
  return contentType.toLowerCase().includes('json');
}
/** Waits for one round of response body reads, giving up after {@link BODY_SETTLE_TIMEOUT_MS} so a read the browser will never finish cannot hold teardown open; answers `false` when the wait timed out. */
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
function summariseExchange(exchange: NormalizedExchange): NormalizedValue {
  return `${exchange.method} ${exchange.path} -> ${exchange.status}`;
}
function exchangeAt(exchanges: readonly NormalizedExchange[], index: number): NormalizedExchange | undefined {
  return index < exchanges.length ? exchanges[index] : undefined;
}
function asArray(value: NormalizedValue): readonly NormalizedValue[] | null {
  return Array.isArray(value) ? value : null;
}
function asObject(value: NormalizedValue): { [key: string]: NormalizedValue } | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function fieldValue(record: { [key: string]: NormalizedValue }, key: string): NormalizedValue {
  return Object.hasOwn(record, key) ? record[key] : null;
}
function elementAt(values: readonly NormalizedValue[], index: number): NormalizedValue {
  return index < values.length ? values[index] : null;
}
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
/** Compares two captures call by call in the order the pages issued them, pairing exchanges by position and never by content (AAP 0.10.1); `origin` is not compared because the fixture's host gate owns it (Rule 2), and nothing throws — a shape the walk cannot follow is itself reported as a difference. */
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

