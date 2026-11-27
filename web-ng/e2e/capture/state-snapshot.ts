/** Post-workflow Fineract state reader for the parity suite: reads one workflow's end state back out of the backend, reduces each resource to a comparison-ready subset (AAP 0.10.1), writes (AAP 0.10.2, Rule 1 clause 9). */
import * as filesystem from 'node:fs';
import { join } from 'node:path';
import { request } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';

import {
  apiHeaders,
  apiUrl,
  authenticate,
  dayOffset,
  FixtureRequestError,
  formatDateOnly,
  parseFineractDate,
  readBusinessDate,
} from '../seed/fixtures';
import { CAPTURES_DIR, fileNamePart } from './network-capture';
import type { NormalizedValue } from './network-capture';

/** A client's end state after a workflow, reduced to what AAP 0.10.1 asserts: W2's activation, W3's sections and the counts a workflow adds to. */
export interface ClientSnapshot {
  readonly status: string;
  /** Days from the run date to the client's activation date, or `null` when it has none — offsets keep the comparison valid on any run date (AAP 0.10.2). */
  readonly activationDateOffset: number | null;
  /** The seed office the client sits in — a fixed seed id (office 1, AAP 0.10.1), not a generated one. */
  readonly officeId: number | null;
  readonly displayName: string;
  /** Loans in `GET /clients/{id}/accounts`; `0` when the payload held no loan list. */
  readonly loanAccountCount: number;
  readonly savingsAccountCount: number;
  /** Identifiers in `GET /clients/{id}/identifiers`; `0` when the client has none. */
  readonly identifierCount: number;
}
export interface LoanSnapshot {
  readonly status: string;
  readonly principal: number | null;
  readonly approvedPrincipal: number | null;
  /** `summary.totalExpectedRepayment` — what W6's outstanding balance is measured against. */
  readonly totalExpectedRepayment: number | null;
  readonly totalOutstanding: number | null;
  /** The first numbered installment's total due, the amount W6 repays: `totalDue`, or `totalDueForPeriod` as the running fork sends it, skipping the leading disbursement row that has no period and a zero total (AAP 0.7.2, `RepaymentPeriod`). */
  readonly firstPeriodTotalDue: number | null;
  readonly transactionCount: number;
  readonly chargeCount: number;
}
export interface StateSnapshot {
  readonly project: 'legacy' | 'next';
  readonly workflow: string;
  readonly runDate: string;
  readonly client?: ClientSnapshot;
  readonly loan?: LoanSnapshot;
}
export interface WrittenStateSnapshot extends StateSnapshot {
  readonly path: string;
}
export interface StateTargets {
  project: 'legacy' | 'next';
  /** Workflow id the snapshot covers, e.g. `'W1'` … `'W7'` or `'CHAIN'`. */
  workflow: string;
  clientId?: number;
  loanId?: number;
  /** Run date to offset dates against; defaults to {@link readBusinessDate} — the tenant's business date, never the browser clock (Rule 1 clause 2). */
  runDate?: Date;
}
/** One field-level difference between the two front ends' end states, shaped like the traffic side's `ExchangeDiff` so the report writer renders both the same way. */
export interface StateDiff {
  readonly field: string;
  readonly legacy: NormalizedValue;
  readonly next: NormalizedValue;
}
/** Raised when a snapshot read answers with anything but a usable 2xx JSON body; it carries the resource path and HTTP status (`0` when no response arrived) and deliberately no body, header or credential (Rule 1 clause 9). */
export class StateSnapshotError extends Error {
  readonly endpoint: string;
  readonly status: number;

  constructor(endpoint: string, status: number, message?: string) {
    super(message ?? `GET ${endpoint} failed with HTTP ${status}`);
    this.name = 'StateSnapshotError';
    this.endpoint = endpoint;
    this.status = status;
  }
}
/** A response body as a plain object, or `null` when it is anything else: every Fineract response crosses an HTTP boundary unmodelled, and the four narrowing helpers here are the documented point where that stops (Rule 1 clause 4). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function field(record: Record<string, unknown> | null, key: string): unknown {
  return record === null ? undefined : record[key];
}
/** The elements of an array, or `[]` when the value is not one — a count over an absent list is `0`, which is what "this client has no loan" means. */
function asArray(value: unknown): readonly unknown[] {
  // `Array.isArray` narrows to `any[]`; this cast restores `unknown` for the elements so a consumer still has to narrow what it reads (Rule 1 clause 4).
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}
/** The value when it is a string, `null` otherwise. An empty string is kept: it is a value Fineract sent. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
/** The value when it is a finite number, `null` otherwise: an absent number is never coerced to `0`, which is a real balance and a real count. */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** The client's activation date, or `null`: Fineract reports it as a top-level `activationDate` or as `timeline.activatedOnDate`, which name the same event, so the top-level field wins where it exists — read through {@link parseFineractDate}, the one date reader the harness shares (AAP 0.10.2). */
function clientActivationDate(client: Record<string, unknown> | null): Date | null {
  const direct = parseFineractDate(field(client, 'activationDate'));
  if (direct !== null) {
    return direct;
  }
  return parseFineractDate(field(asRecord(field(client, 'timeline')), 'activatedOnDate'));
}
/** The status a resource payload names, e.g. `Active`; empty only when the payload carried no `status.value`, which a diff should show rather than have substituted. */
function statusOf(record: Record<string, unknown> | null): string {
  return asString(field(asRecord(field(record, 'status')), 'value')) ?? '';
}
/** The name the client record shows: Fineract composes `displayName` for a person and an entity alike, and the fallbacks serve a payload that predates it instead of weakening every W3 comparison. */
function clientDisplayName(client: Record<string, unknown> | null): string {
  const named = asString(field(client, 'displayName')) ?? asString(field(client, 'displayname'));
  if (named !== null && named.length > 0) {
    return named;
  }
  const parts = [
    asString(field(client, 'firstname')),
    asString(field(client, 'middlename')),
    asString(field(client, 'lastname')),
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 0 ? parts.join(' ') : (asString(field(client, 'fullname')) ?? '');
}
/** The first numbered installment's total due — the amount W6 repays (AAP 0.10.1 W6; AAP 0.7.2 `RepaymentPeriod`) — read as `totalDue` with a fallback to this fork's `totalDueForPeriod`, skipping the disbursement row that carries no period or a `period` of 0; `null` before approval builds a schedule. */
function firstPeriodTotalDue(schedule: Record<string, unknown> | null): number | null {
  for (const row of asArray(field(schedule, 'periods'))) {
    const period = asRecord(row);
    const number = asNumber(field(period, 'period'));
    if (number === null || !Number.isInteger(number) || number < 1) {
      continue;
    }
    const totalDue = asNumber(field(period, 'totalDue')) ?? asNumber(field(period, 'totalDueForPeriod'));
    if (totalDue !== null) {
      return totalDue;
    }
  }
  return null;
}
/** Reduces a `GET /clients/{id}` payload, with the accounts from `GET /clients/{id}/accounts` and the identifiers from `GET /clients/{id}/identifiers`, to a {@link ClientSnapshot} (AAP 0.7.3 W3; AAP 0.10.1 W2); pure and exported so the narrowing can be exercised without a backend. */
export function reduceClient(
  raw: unknown,
  accounts: unknown,
  identifiers: unknown,
  runDate: Date,
): ClientSnapshot {
  const client = asRecord(raw);
  const accountsPayload = asRecord(accounts);
  const activationDate = clientActivationDate(client);
  return {
    status: statusOf(client),
    activationDateOffset: activationDate === null ? null : dayOffset(runDate, activationDate),
    officeId: asNumber(field(client, 'officeId')),
    displayName: clientDisplayName(client),
    loanAccountCount: asArray(field(accountsPayload, 'loanAccounts')).length,
    savingsAccountCount: asArray(field(accountsPayload, 'savingsAccounts')).length,
    identifierCount: asArray(identifiers).length,
  };
}
/** Reduces a `GET /loans/{id}?associations=all` payload to a {@link LoanSnapshot} (AAP 0.7.3 W6; AAP 0.10.1 W4, W5 and W6); pure and exported for the same reason as {@link reduceClient}. */
export function reduceLoan(raw: unknown): LoanSnapshot {
  const loan = asRecord(raw);
  const summary = asRecord(field(loan, 'summary'));
  return {
    status: statusOf(loan),
    principal: asNumber(field(loan, 'principal')),
    approvedPrincipal: asNumber(field(loan, 'approvedPrincipal')),
    totalExpectedRepayment: asNumber(field(summary, 'totalExpectedRepayment')),
    totalOutstanding: asNumber(field(summary, 'totalOutstanding')),
    firstPeriodTotalDue: firstPeriodTotalDue(asRecord(field(loan, 'repaymentSchedule'))),
    transactionCount: asArray(field(loan, 'transactions')).length,
    chargeCount: asArray(field(loan, 'charges')).length,
  };
}
type QueryParameters = Readonly<Record<string, string>>;
/** The association set the loan read asks for — `?associations=all`, which is what the record screen sends (AAP 0.7.3 W6) — passed as the request's `params` option so this module carries no URL literal. */
const ALL_ASSOCIATIONS: QueryParameters = { associations: 'all' };
/** A resource path with its query parameters rendered, e.g. `/loans/45?associations=all`: used only to name a resource in an error, keys sorted so the same read always labels the same. */
function endpointLabel(resourcePath: string, params: QueryParameters | undefined): string {
  const keys = params === undefined ? [] : Object.keys(params).sort();
  if (keys.length === 0) {
    return resourcePath;
  }
  return `${resourcePath}?${keys.map((key) => `${key}=${params?.[key] ?? ''}`).join('&')}`;
}
/** Reads one Fineract resource as `unknown` over {@link apiUrl}, so it can only address a path below the API root (Rule 1 clause 2) and leaves narrowing to the reducers (Rule 1 clause 4). @throws {@link StateSnapshotError} naming the resource path and the status and nothing else — no raw body, and no Playwright failure text, which appends the request headers (Rule 1 clause 9). */
async function readJson(
  context: APIRequestContext,
  resourcePath: string,
  params?: QueryParameters,
): Promise<unknown> {
  const url = apiUrl(resourcePath);
  const endpoint = endpointLabel(resourcePath, params);
  let response: APIResponse;
  try {
    response = await context.get(url, params === undefined ? {} : { params });
  } catch {
    // The caught error is deliberately not echoed: Playwright reports a failed API call together with the request's headers, which carry the credential (Rule 1 clause 9).
    throw new StateSnapshotError(
      endpoint,
      0,
      `GET ${endpoint} produced no HTTP response: the connection was refused, the TLS handshake failed or the call timed out.`,
    );
  }
  const status = response.status();
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new StateSnapshotError(
      endpoint,
      status,
      `GET ${endpoint} answered HTTP ${status} with a body that could not be read.`,
    );
  }
  if (!response.ok()) {
    throw new StateSnapshotError(endpoint, status);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new StateSnapshotError(
      endpoint,
      status,
      `GET ${endpoint} answered HTTP ${status} with a body that is not JSON.`,
    );
  }
}
/** Runs `work` against a fresh Playwright request context and always disposes of it: the one place a context is created, so the credential reaches the backend only as `apiHeaders()` headers, never in a URL, a message or a file (AAP 0.4.3 for the self-signed certificate). */
async function withContext<T>(work: (context: APIRequestContext) => Promise<T>): Promise<T> {
  const context = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: apiHeaders(await authenticate()),
  });
  try {
    return await work(context);
  } finally {
    await context.dispose();
  }
}
/** A resource id, checked before it reaches a path: a non-integer would render as `/clients/NaN`, which is no endpoint and no path the allowlist holds. */
function requireResourceId(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${String(value)}.`);
  }
  return value;
}
function optionalResourceId(value: number | undefined, name: string): number | undefined {
  return value === undefined ? undefined : requireResourceId(value, name);
}
/** Resource path of the tenant business-date read, `GET /businessdate/BUSINESS_DATE`; harness-only, so it belongs in `web-ng/tools/parity/harness-allowlist.json` and never in the application's allowlist (AAP 0.9.4 row 9; AAP 0.10.4; AAP 0.10.5 item 15). */
const BUSINESS_DATE_ENDPOINT = '/businessdate/BUSINESS_DATE';
/** The run date a snapshot offsets its dates against: the caller's when supplied, otherwise the tenant's business date read from Fineract through the seed module and rethrown here as a {@link StateSnapshotError} naming the endpoint and the status (Rule 1 clause 2; AAP 0.10.1, "Run date"). */
async function resolveRunDate(runDate: Date | undefined): Promise<Date> {
  if (runDate !== undefined) {
    const supplied = new Date(runDate.getTime());
    if (Number.isNaN(supplied.getTime())) {
      throw new Error(`The run date must be a valid Date; received ${String(runDate)}.`);
    }
    return supplied;
  }
  let businessDate: Date;
  try {
    businessDate = await readBusinessDate();
  } catch (error) {
    // The caught error is deliberately neither echoed nor chained as `cause`: readBusinessDate sends the session headers with its call and Playwright reports a failed API call together with those headers, which carry the credential (Rule 1 clause 9) — the endpoint and the status say what failed.
    const status = error instanceof FixtureRequestError ? error.status : 0;
    let what =
      `GET ${BUSINESS_DATE_ENDPOINT} did not produce a usable business date: the read reported no HTTP ` +
      'status, so either the harness credentials are missing or the answer is not the documented ' +
      '`{description, type, date: [year, month, day]}` payload.';
    if (error instanceof FixtureRequestError) {
      what =
        status === 0
          ? `GET ${BUSINESS_DATE_ENDPOINT} produced no HTTP response: the connection was refused, the TLS handshake failed or the call timed out.`
          : `GET ${BUSINESS_DATE_ENDPOINT} failed with HTTP ${status}.`;
    }
    throw new StateSnapshotError(
      BUSINESS_DATE_ENDPOINT,
      status,
      `${what} The tenant's business date is the run date every snapshot date is offset against, ` +
        'and the browser clock is never a substitute for it (Rule 1 clause 2).',
    );
  }
  return businessDate;
}
/** Reads a client's end state: `GET /clients/{id}`, `GET /clients/{id}/accounts` and `GET /clients/{id}/identifiers`, all three of which AAP 0.7.3 lists for W2 and W3, reduced together. */
async function readClient(
  context: APIRequestContext,
  clientId: number,
  runDate: Date,
): Promise<ClientSnapshot> {
  const clientPath = `/clients/${clientId}`;
  const raw = await readJson(context, clientPath);
  const accounts = await readJson(context, `${clientPath}/accounts`);
  const identifiers = await readJson(context, `${clientPath}/identifiers`);
  return reduceClient(raw, accounts, identifiers, runDate);
}
/** A client's end state read from Fineract (AAP 0.7.3 W3; AAP 0.10.1 W2 and W3) over its own context, which it disposes of; {@link captureState} is the entry point that reuses one context across a workflow's resources. */
export async function snapshotClient(clientId: number, runDate?: Date): Promise<ClientSnapshot> {
  const id = requireResourceId(clientId, 'clientId');
  const resolvedRunDate = await resolveRunDate(runDate);
  return withContext((context) => readClient(context, id, resolvedRunDate));
}
/** A loan account's end state from `GET /loans/{id}?associations=all`, whose associations bring the schedule, the transactions and the charges into one answer (AAP 0.7.3 W6; AAP 0.10.1 W4 to W7). */
export async function snapshotLoan(loanId: number): Promise<LoanSnapshot> {
  const id = requireResourceId(loanId, 'loanId');
  return withContext(async (context) =>
    reduceLoan(await readJson(context, `/loans/${id}`, ALL_ASSOCIATIONS)),
  );
}
/** Reads the end state of every targeted resource, writes it as one snapshot file and returns a {@link WrittenStateSnapshot}: one authentication and one context serve every resource, and a workflow that touched only a client writes `client` and nothing else. @throws {@link StateSnapshotError} when a read fails; `Error` when no resource was targeted, an id is not a positive integer, `workflow` is blank or `runDate` is invalid. */
export async function captureState(targets: StateTargets): Promise<WrittenStateSnapshot> {
  const clientId = optionalResourceId(targets.clientId, 'clientId');
  const loanId = optionalResourceId(targets.loanId, 'loanId');
  if (clientId === undefined && loanId === undefined) {
    throw new Error(
      'captureState() needs at least one of clientId or loanId: a snapshot of nothing cannot ' +
        'be compared with the other front end.',
    );
  }
  const workflow = targets.workflow.trim();
  if (workflow.length === 0) {
    throw new Error('captureState() needs a workflow id, for example "W2" or "CHAIN".');
  }
  const runDate = await resolveRunDate(targets.runDate);
  return withContext(async (context) => {
    const client = clientId === undefined ? undefined : await readClient(context, clientId, runDate);
    const loan =
      loanId === undefined
        ? undefined
        : reduceLoan(await readJson(context, `/loans/${loanId}`, ALL_ASSOCIATIONS));
    const written = {
      project: targets.project,
      workflow,
      runDate: formatDateOnly(runDate),
      ...(client === undefined ? {} : { client }),
      ...(loan === undefined ? {} : { loan }),
    };
    const directory = join(CAPTURES_DIR, 'state');
    filesystem.mkdirSync(directory, { recursive: true });
    const file = join(directory, `${fileNamePart(targets.project)}__${fileNamePart(workflow)}.json`);
    filesystem.writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
    return { ...written, path: file };
  });
}
const CLIENT_FIELDS: readonly (keyof ClientSnapshot)[] = [
  'status',
  'activationDateOffset',
  'officeId',
  'displayName',
  'loanAccountCount',
  'savingsAccountCount',
  'identifierCount',
];
const LOAN_FIELDS: readonly (keyof LoanSnapshot)[] = [
  'status',
  'principal',
  'approvedPrincipal',
  'totalExpectedRepayment',
  'totalOutstanding',
  'firstPeriodTotalDue',
  'transactionCount',
  'chargeCount',
];
/** A snapshot field as a comparable JSON value; anything but a scalar is malformed input from outside and is rendered as text rather than thrown on, because an incomplete comparison is a finding in its own right. */
function asNormalized(value: unknown): NormalizedValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return value === undefined ? null : String(value);
}
/** Compares one section of two snapshots field by field, pushing a {@link StateDiff} per difference; a section present on one side only reads `null` for every field, and two absent sections agree. */
function compareSection(
  sectionName: string,
  fieldNames: readonly string[],
  legacy: unknown,
  next: unknown,
  differences: StateDiff[],
): void {
  const legacyRecord = asRecord(legacy);
  const nextRecord = asRecord(next);
  for (const name of fieldNames) {
    const legacyValue = asNormalized(field(legacyRecord, name));
    const nextValue = asNormalized(field(nextRecord, name));
    if (legacyValue !== nextValue) {
      differences.push({ field: `${sectionName}.${name}`, legacy: legacyValue, next: nextValue });
    }
  }
}
/** Compares the two front ends' end states (AAP 0.10.1 criterion 4; AAP 0.10.2); an empty array is parity. `project`, `workflow` and `runDate` are ignored because they describe the run rather than the outcome, and nothing throws — a malformed section or field is reported as a difference. */
export function diffStates(legacy: StateSnapshot, next: StateSnapshot): StateDiff[] {
  const differences: StateDiff[] = [];
  compareSection('client', CLIENT_FIELDS, legacy.client, next.client, differences);
  compareSection('loan', LOAN_FIELDS, legacy.loan, next.loan, differences);
  return differences;
}

