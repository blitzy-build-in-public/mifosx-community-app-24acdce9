/**
 * Post-workflow Fineract state reader for the legacy-versus-next parity suite: it reads one workflow's
 * end state back out of the backend, reduces each resource to a small comparison-ready subset, writes
 * the snapshot under `web-ng/e2e/.captures/state/`, and diffs the two front ends' snapshots.
 *
 * Why this module exists. Parity is behavioural (AAP 0.1.1): a workflow passes when the new
 * application produces the same Fineract end state through the same API calls as the legacy
 * application (AAP 0.10.1). The traffic side of that comparison is the sibling
 * `capture/network-capture.ts`; the *outcome* side is this file — AAP 0.10.1 defines a workflow's
 * outcome as "the backend state read back through the API afterwards", and that read happens here.
 * The reduced object is therefore what a human reads in `parity-report.json` to see whether the
 * legacy run and the new-app run ended in the same financial state.
 *
 * What is deliberately dropped (AAP 0.10.2):
 *
 * - **Generated ids** — a client, loan, savings account, transaction or charge created during a run
 *   is compared by its role in the sequence, never by its literal id, so no response `id` is kept.
 * - **Audit timestamps** — `timestamps` subtrees and any clock time are dropped; no workflow asserts
 *   them, and a wall clock would differ between the two runs by construction.
 * - **Dates as literals** — every date is reduced to a day offset from the run date, so a comparison
 *   survives a run that happens on a different day (AAP 0.10.2, "Dates").
 * - **Everything a resource carries beyond the subset each `*Snapshot` interface declares** — summary
 *   prose, names of offices and products, per-period schedules and free-text notes are UI material,
 *   and the screens' own specs assert them.
 *
 * The one artefact written is one JSON file per project and workflow,
 * `<CAPTURES_DIR>/state/<project>__<workflow>.json`, at a path fixed by {@link CAPTURES_DIR} in the
 * sibling capture module (`web-ng/.gitignore` ignores `/e2e/.captures`, so nothing written there can
 * be committed). Two runs that ended in the same state produce byte-identical files: the key order is
 * the object literal's, nothing is ordered by payload order, and the file records no absolute path, no
 * clock time and no generated id.
 *
 * The written file holds **no header, no cookie and no auth material** — not the credential, not the
 * authentication key, not the tenant value (Rule 1 clause 9). The credential reaches the backend only
 * as the header set `apiHeaders()` builds, inside a request context that is disposed before this module
 * returns; the file holds reduced state alone. Errors name the resource path and the HTTP status and
 * nothing else, never a response body and never Playwright's own failure text, which appends the
 * request headers to the message. That covers every read here, the run-date read included: a failure
 * to read the tenant's business date is rethrown as a {@link StateSnapshotError} naming the
 * business-date endpoint, so the seed module's own error — which knows nothing of this module's
 * contract — never reaches a caller's log.
 *
 * It imports the already-pinned `@playwright/test` (its `request` fixture — the API context accepts the
 * local backend's self-signed certificate), two Node builtins, and two harness modules. It adds no
 * dependency (Rule 1 clause 7) and imports nothing from `web-ng/src`: the harness stays independent of
 * the application's models, so the small DTOs below are its own.
 */
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

/**
 * A client's end state after a workflow, reduced to what AAP 0.10.1 asserts (W2's activation, W3's
 * sections, and the counts a workflow adds to).
 */
export interface ClientSnapshot {
  /** Status as Fineract names it, e.g. `Active`; `''` only when the payload carried none. */
  readonly status: string;
  /** Days from the run date to the activation date, or `null` when the client has no activation
   * date. Offsets rather than dates keep the comparison valid on any run date (AAP 0.10.2). */
  readonly activationDateOffset: number | null;
  /** The seed office the client sits in — a fixed seed id (office 1, AAP 0.10.1), not a generated one. */
  readonly officeId: number | null;
  /** The name the record screen shows, e.g. `Parity Client`. */
  readonly displayName: string;
  /** Loans in `GET /clients/{id}/accounts`; `0` when the payload held no loan list. */
  readonly loanAccountCount: number;
  /** Savings accounts in the same payload; `0` when it held none. */
  readonly savingsAccountCount: number;
  /** Identifiers in `GET /clients/{id}/identifiers`; `0` when the client has none. */
  readonly identifierCount: number;
}

/**
 * A loan account's end state, reduced to what W4 to W7 assert: the terms that were submitted, the
 * money the schedule and the balance carry, and the transactions and charges a workflow adds.
 */
export interface LoanSnapshot {
  /** Status as Fineract names it, e.g. `Submitted` or `Active`; `''` only when the payload carried none. */
  readonly status: string;
  /** Principal as submitted — W4's 5,000. */
  readonly principal: number | null;
  /** Approved principal; `null` before approval, which is itself the assertion W4 makes. */
  readonly approvedPrincipal: number | null;
  /** `summary.totalExpectedRepayment` — what W6's outstanding balance is measured against. */
  readonly totalExpectedRepayment: number | null;
  /** `summary.totalOutstanding` — the balance the repayment must reduce and W5 and W6 assert. */
  readonly totalOutstanding: number | null;
  /** The first installment's total due, the amount W6 repays: `totalDue`, or `totalDueForPeriod` as the
   * running fork sends it — reading only `totalDue` would be `null` on both front ends. The schedule's
   * leading disbursement row carries no period number and a zero total, so it is skipped (AAP 0.7.2,
   * `RepaymentPeriod`). */
  readonly firstPeriodTotalDue: number | null;
  /** Transactions the loan carries; a repayment adds one (W6). */
  readonly transactionCount: number;
  /** Charges attached to the loan; the charge form adds one. */
  readonly chargeCount: number;
}

/** A savings account's end state, reduced to what W8 asserts: status and the three balances. */
export interface SavingsSnapshot {
  /** Status as Fineract names it, e.g. `Submitted` or `Active`; `''` only when the payload carried none. */
  readonly status: string;
  /** `summary.accountBalance` — W8 must end at 800 (deposit 1,000, withdrawal 200). */
  readonly accountBalance: number | null;
  /** `summary.totalDeposits` — W8's 1,000. */
  readonly totalDeposits: number | null;
  /** `summary.totalWithdrawals` — W8's 200. */
  readonly totalWithdrawals: number | null;
}

/**
 * One workflow's end state on one front end, plus the metadata that makes the written file
 * self-describing. `client`, `loan` and `savings` are present only when the caller asked for them.
 *
 * This is the shape of the document on disk, so it holds nothing that names the machine the run
 * happened on: an absolute path recorded here would stop two runs that ended in the same state from
 * producing byte-identical files. {@link WrittenStateSnapshot} adds the one run-only field,
 * {@link WrittenStateSnapshot.path}, to what {@link captureState} returns.
 */
export interface StateSnapshot {
  /** Playwright project the snapshot came from. */
  readonly project: 'legacy' | 'next';
  /** Workflow id the snapshot covers, e.g. `W2` or `CHAIN`. */
  readonly workflow: string;
  /** The run date the dates were offset from, `yyyy-mm-dd`. */
  readonly runDate: string;
  /** Client end state, when the workflow targeted a client. */
  readonly client?: ClientSnapshot;
  /** Loan end state, when the workflow targeted a loan. */
  readonly loan?: LoanSnapshot;
  /** Savings end state, when the workflow targeted a savings account. */
  readonly savings?: SavingsSnapshot;
}

/**
 * A snapshot as {@link captureState} returns it: the written document plus the absolute path of the
 * file it wrote.
 *
 * The path is the one field a snapshot carries that deliberately does not reach the file (AAP 0.10.2;
 * AAP 0.10.1's outcome is the backend state, not the run). It locates the artefact for a reader of the
 * report, and it would differ between the two runs by construction, so the written document leaves it
 * out and a snapshot reloaded from disk is a plain {@link StateSnapshot} — which is what
 * {@link diffStates} compares.
 */
export interface WrittenStateSnapshot extends StateSnapshot {
  /** Absolute path of the file this snapshot was written to. */
  readonly path: string;
}

/**
 * What {@link captureState} is asked to read. Every target is optional and independent: a workflow
 * that touched only a client asks for the client alone, and the written file then holds `client` only.
 */
export interface StateTargets {
  /** Playwright project the snapshot belongs to. */
  project: 'legacy' | 'next';
  /** Workflow id the snapshot covers, e.g. `'W1'` … `'W8'` or `'CHAIN'`. */
  workflow: string;
  /** Client to read; validated as a positive integer before any call is made. */
  clientId?: number;
  /** Loan to read; validated the same way. */
  loanId?: number;
  /** Savings account to read; validated the same way. */
  savingsId?: number;
  /** Run date to offset dates against; defaults to {@link readBusinessDate} (the tenant's business
   * date, never the browser clock — Rule 1 clause 2). */
  runDate?: Date;
}

/**
 * One field-level difference between the two front ends' end states, shaped like the traffic side's
 * `ExchangeDiff` so the report writer renders both the same way.
 */
export interface StateDiff {
  /** What differs, as a value path: `client.status`, `loan.totalOutstanding`,
   * `savings.accountBalance`. */
  readonly field: string;
  /** The legacy side's value; `null` when that side has no such section or the field is absent. */
  readonly legacy: NormalizedValue;
  /** The new app's value; `null` when that side has no such section or the field is absent. */
  readonly next: NormalizedValue;
}

/**
 * Raised when the backend answers a snapshot read with anything but a usable 2xx JSON body.
 *
 * It carries the resource path and the HTTP status so a report can say what failed; `status` is `0`
 * when no response arrived at all (a refused connection or a timeout). It deliberately carries no
 * response body, no header and no request context, so nothing that reaches a report or a log can hold
 * a credential (Rule 1 clause 9).
 */
export class StateSnapshotError extends Error {
  /** The resource the read asked for, e.g. `/loans/45?associations=all` — a path, never a host. */
  readonly endpoint: string;
  /** HTTP status Fineract answered with, or `0` when no response arrived. */
  readonly status: number;

  constructor(endpoint: string, status: number, message?: string) {
    super(message ?? `GET ${endpoint} failed with HTTP ${status}`);
    this.name = 'StateSnapshotError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

/**
 * A response body as a plain object, or `null` when it is anything else.
 *
 * Every Fineract response enters this module as `unknown` because it crosses an HTTP boundary the
 * harness does not own; the four narrowing helpers below are the documented boundary at which that
 * stops (Rule 1 clause 4). They answer `null`/`[]` instead of throwing, so one field of an unexpected
 * shape never fails a whole workflow, and a snapshot degrades to "absent" rather than to a guess.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One key of an object, or `undefined` when the object is absent or holds no such key. */
function field(record: Record<string, unknown> | null, key: string): unknown {
  return record === null ? undefined : record[key];
}

/**
 * The elements of an array, or `[]` when the value is not one. `[]` is the honest answer for a list a
 * payload did not carry: a count over it is `0`, which is what "this client has no loan" means.
 */
function asArray(value: unknown): readonly unknown[] {
  // `Array.isArray` narrows to `any[]`; this cast restores `unknown` for the elements so a consumer
  // still has to narrow what it reads (Rule 1 clause 4).
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** The value when it is a string, `null` otherwise. An empty string is kept: it is a value Fineract sent. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The value when it is a finite number, `null` otherwise. A number that is absent stays `null` and is
 * never coerced to `0`: `0` is a real balance and a real transaction count, so confusing the two would
 * hide exactly the difference a parity comparison exists to find.
 */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The client's activation date, or `null` when it has none.
 *
 * Fineract reports this fact in two places depending on the resource version: a top-level
 * `activationDate` on the client payload, and `timeline.activatedOnDate`. Both name the same event, so
 * the top-level field wins where it exists and the timeline answers otherwise — reading only one of them
 * would leave W2's "activated on the run date" assertion silently unassertable against a backend that
 * populated the other. The `[year, month, day]` triple, the `dd MMMM yyyy` text and the `yyyy-mm-dd`
 * text all read through {@link parseFineractDate}, the one date reader the harness and the capture
 * share (AAP 0.10.2, "Dates").
 */
function clientActivationDate(client: Record<string, unknown> | null): Date | null {
  const direct = parseFineractDate(field(client, 'activationDate'));
  if (direct !== null) {
    return direct;
  }
  return parseFineractDate(field(asRecord(field(client, 'timeline')), 'activatedOnDate'));
}

/**
 * The status a resource payload names, e.g. `Active`. Empty only when the payload carried no
 * `status.value` at all, which is itself worth seeing in a diff rather than substituting a label.
 */
function statusOf(record: Record<string, unknown> | null): string {
  return asString(field(asRecord(field(record, 'status')), 'value')) ?? '';
}

/**
 * The name the client record shows. Fineract composes `displayName` for a person and for an entity
 * alike; the fallbacks exist because a payload that predates that field carries the parts instead, and
 * an empty name would weaken every W3 comparison without saying so.
 */
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

/**
 * The first installment's total due, which is the amount W6 repays (AAP 0.10.1 W6; AAP 0.7.2,
 * `RepaymentPeriod`).
 *
 * The schedule leads with a disbursement or down-payment row that carries no period number — or a
 * `period` of 0 — and a zero total, so the walk takes the first row whose `period` is an integer of 1 or
 * more rather than the array's first element: reading element 0 would report `0` and turn W6's
 * outstanding-balance assertion into an identity. The amount is read as `totalDue`, the field AAP 0.7.2
 * names, and falls back to `totalDueForPeriod`, the field this fork actually sends — reading one
 * spelling alone leaves the amount `null` on both front ends and makes the comparison vacuous. `null`
 * when no numbered period carries a due amount, which is the state a loan is in before approval builds
 * a schedule.
 */
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

/**
 * Reduces a `GET /clients/{id}` payload, with the accounts and identifiers payloads from
 * `GET /clients/{id}/accounts` and `GET /clients/{id}/identifiers`, to a {@link ClientSnapshot}
 * (AAP 0.7.3 W3; AAP 0.10.1 W2).
 *
 * Pure and exported so the narrowing can be exercised without a backend: {@link snapshotClient} calls
 * it with what the API answered, and the harness's own checks call it with a fixed payload.
 *
 * @param raw Client payload.
 * @param accounts `GET /clients/{id}/accounts` payload; a missing list counts as `0`.
 * @param identifiers `GET /clients/{id}/identifiers` payload; `0` when the client has none.
 * @param runDate The tenant's business date the activation date is offset against (AAP 0.10.1).
 */
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

/**
 * Reduces a `GET /loans/{id}?associations=all` payload to a {@link LoanSnapshot} (AAP 0.7.3 W6;
 * AAP 0.10.1 W4, W5 and W6). Pure and exported for the same reason as {@link reduceClient}.
 *
 * @param raw Loan payload, with its schedule, transactions and charges associated.
 */
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

/**
 * Reduces a `GET /savingsaccounts/{id}?associations=all` payload to a {@link SavingsSnapshot}
 * (AAP 0.7.3 W8). Pure and exported for the same reason as {@link reduceClient}.
 *
 * @param raw Savings account payload.
 */
export function reduceSavings(raw: unknown): SavingsSnapshot {
  const savings = asRecord(raw);
  const summary = asRecord(field(savings, 'summary'));
  return {
    status: statusOf(savings),
    accountBalance: asNumber(field(summary, 'accountBalance')),
    totalDeposits: asNumber(field(summary, 'totalDeposits')),
    totalWithdrawals: asNumber(field(summary, 'totalWithdrawals')),
  };
}


/** Query parameters of one snapshot read, in the shape Playwright's `params` option takes. */
type QueryParameters = Readonly<Record<string, string>>;

/**
 * The association set the loan and savings record reads ask for — `?associations=all`, the same query
 * parameter the record screens send (AAP 0.7.3 W6 and W8). It is passed as the request's `params`
 * option rather than written into a URL string, so this module carries no URL literal that could name
 * an endpoint the allowlist does not hold.
 */
const ALL_ASSOCIATIONS: QueryParameters = { associations: 'all' };

/**
 * A resource path with its query parameters rendered, e.g. `/loans/45?associations=all`. Used only to
 * name a resource in an error, so a reader knows which read failed; keys are sorted so the same read
 * always produces the same label.
 */
function endpointLabel(resourcePath: string, params: QueryParameters | undefined): string {
  const keys = params === undefined ? [] : Object.keys(params).sort();
  if (keys.length === 0) {
    return resourcePath;
  }
  return `${resourcePath}?${keys.map((key) => `${key}=${params?.[key] ?? ''}`).join('&')}`;
}

/**
 * Reads one Fineract resource as `unknown`.
 *
 * The URL comes from {@link apiUrl}, so this module can only address a path below the API root and can
 * never assemble an address the application does not use (Rule 1 clause 2). The response is not
 * modelled: every caller hands it to a reducer, which is where narrowing happens (Rule 1 clause 4).
 *
 * @param context Request context carrying the credential and tenant headers.
 * @param resourcePath Path below the API root, starting with `/`.
 * @param params Query parameters, passed as the request's `params` option.
 * @throws {@link StateSnapshotError} when no response arrives, when Fineract answers non-2xx, or when
 * the body is not JSON. The message names the resource path and the status and nothing else: the raw
 * body is not echoed, and neither is Playwright's own failure text, which appends the request headers
 * to the message it reports (Rule 1 clause 9).
 */
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
    // The caught error is deliberately not echoed: Playwright reports a failed API call together with
    // the request's headers, which carry the credential (Rule 1 clause 9).
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

/**
 * Runs `work` against a fresh Playwright request context and always disposes of it.
 *
 * This is the single place a context is created, so the credential reaches the backend in exactly one
 * way: `apiHeaders()` on the context's own headers, never in a URL, a message or a file. The context
 * accepts the local backend's self-signed certificate, which is why Playwright's API context is used
 * rather than a bare `fetch` (AAP 0.4.3).
 *
 * @param work What to do with the context.
 */
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

/**
 * A resource id, checked before it is put in a path. A non-integer would render as `/clients/NaN`, which
 * is not an endpoint anyone can read and not a path the allowlist holds, so a caller that passes one has
 * a bug and hears about it here rather than as a puzzling HTTP failure.
 */
function requireResourceId(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${String(value)}.`);
  }
  return value;
}

/** An optional resource id, validated only when the caller supplied one. */
function optionalResourceId(value: number | undefined, name: string): number | undefined {
  return value === undefined ? undefined : requireResourceId(value, name);
}

/**
 * Resource path of the tenant business-date read, `GET /businessdate/BUSINESS_DATE`. Harness-only: the
 * application derives its form dates from the browser clock exactly as legacy does, so this endpoint
 * belongs in `web-ng/tools/parity/harness-allowlist.json` and never in the application's allowlist
 * (AAP 0.9.4 row 9; AAP 0.10.4; AAP 0.10.5 item 15).
 */
const BUSINESS_DATE_ENDPOINT = '/businessdate/BUSINESS_DATE';

/**
 * The run date a snapshot offsets its dates against: the caller's when it supplied one, otherwise the
 * tenant's business date read from Fineract (Rule 1 clause 2; AAP 0.10.1, "Run date"). Copied, so a caller
 * cannot change a cached value through the returned object.
 *
 * The read goes through the seed module, whose failure carries no credential of its own but also
 * nothing of this module's contract, so it is translated into a {@link StateSnapshotError} here: the
 * report writer and a failing spec log whatever this module throws, and the read is made with the
 * session headers attached.
 *
 * @param runDate Caller-supplied run date, or `undefined` to read the business date.
 * @throws {@link StateSnapshotError} when the business date cannot be read, carrying the endpoint and
 * the status — `0` when no response arrived at all; `Error` when a supplied `runDate` is not a valid
 * `Date`.
 */
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
    // The caught error is deliberately neither echoed nor chained as `cause`: readBusinessDate sends the
    // session headers with its call, and Playwright reports a failed API call together with those
    // headers, which carry the credential (Rule 1 clause 9). The endpoint and the status say what failed.
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

/**
 * Reads a client's end state: `GET /clients/{id}`, `GET /clients/{id}/accounts` and
 * `GET /clients/{id}/identifiers`, all three of which AAP 0.7.3 lists for W2 and W3, reduced together.
 */
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

/**
 * A client's end state, read from Fineract (AAP 0.7.3 W3; AAP 0.10.1 W2 and W3).
 *
 * Self-sufficient: it authenticates, reads over its own context and disposes of it. {@link captureState}
 * is the entry point for a workflow, and reuses one context across the resources that workflow touched.
 *
 * @param clientId Client to read.
 * @param runDate Run date to offset the activation date against; defaults to the tenant's business date.
 * @throws {@link StateSnapshotError} when a read fails — the run-date read included, which carries the
 * business-date endpoint and the status (`0` when no response arrived); `Error` when `runDate` is not a
 * valid date.
 */
export async function snapshotClient(clientId: number, runDate?: Date): Promise<ClientSnapshot> {
  const id = requireResourceId(clientId, 'clientId');
  const resolvedRunDate = await resolveRunDate(runDate);
  return withContext((context) => readClient(context, id, resolvedRunDate));
}

/**
 * A loan account's end state, read from `GET /loans/{id}?associations=all` (AAP 0.7.3 W6; AAP 0.10.1
 * W4 to W7). The associations are what bring the schedule, the transactions and the charges into one
 * answer, which is why W6's before-and-after comparison reads this endpoint rather than several.
 *
 * @param loanId Loan to read.
 * @throws {@link StateSnapshotError} when the read fails.
 */
export async function snapshotLoan(loanId: number): Promise<LoanSnapshot> {
  const id = requireResourceId(loanId, 'loanId');
  return withContext(async (context) =>
    reduceLoan(await readJson(context, `/loans/${id}`, ALL_ASSOCIATIONS)),
  );
}

/**
 * A savings account's end state, read from `GET /savingsaccounts/{id}?associations=all` (AAP 0.7.3 W8).
 *
 * @param savingsId Savings account to read.
 * @throws {@link StateSnapshotError} when the read fails.
 */
export async function snapshotSavings(savingsId: number): Promise<SavingsSnapshot> {
  const id = requireResourceId(savingsId, 'savingsId');
  return withContext(async (context) =>
    reduceSavings(await readJson(context, `/savingsaccounts/${id}`, ALL_ASSOCIATIONS)),
  );
}

/**
 * Reads the end state of every resource a workflow targeted, writes it as one snapshot file, and
 * returns a {@link WrittenStateSnapshot} — the document it wrote plus that file's absolute path.
 *
 * One authentication and one request context serve every resource (`withContext`), because the workflow
 * is already authenticated and a second login would add a call neither front end made. Targets are
 * independent: a workflow that touched only a client writes a file holding `client` and nothing else.
 *
 * @param targets What to read and the metadata the file records.
 * @throws {@link StateSnapshotError} when a read fails — the run-date read included, whose message names
 * the business-date endpoint and the status and never the request headers; `Error` when no resource was
 * targeted, when an id is not a positive integer, when `workflow` is blank, or when `runDate` is not a
 * valid date. A failure of the authentication `withContext` makes surfaces as the seed module's
 * `FixtureRequestError`, which names `/authentication` and the status and nothing else either.
 */
export async function captureState(targets: StateTargets): Promise<WrittenStateSnapshot> {
  const clientId = optionalResourceId(targets.clientId, 'clientId');
  const loanId = optionalResourceId(targets.loanId, 'loanId');
  const savingsId = optionalResourceId(targets.savingsId, 'savingsId');
  if (clientId === undefined && loanId === undefined && savingsId === undefined) {
    throw new Error(
      'captureState() needs at least one of clientId, loanId or savingsId: a snapshot of nothing cannot ' +
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
    const savings =
      savingsId === undefined
        ? undefined
        : reduceSavings(await readJson(context, `/savingsaccounts/${savingsId}`, ALL_ASSOCIATIONS));
    // The written document is the metadata and the sections the workflow reached, in that order. The
    // absolute path is added to the returned object only: recording it in the file would put a
    // machine-specific path into an artefact two runs are expected to compare byte for byte.
    const written = {
      project: targets.project,
      workflow,
      runDate: formatDateOnly(runDate),
      ...(client === undefined ? {} : { client }),
      ...(loan === undefined ? {} : { loan }),
      ...(savings === undefined ? {} : { savings }),
    };
    const directory = join(CAPTURES_DIR, 'state');
    filesystem.mkdirSync(directory, { recursive: true });
    const file = join(directory, `${fileNamePart(targets.project)}__${fileNamePart(workflow)}.json`);
    filesystem.writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
    return { ...written, path: file };
  });
}

/**
 * The fields compared for each section, in the order a reader expects them. Typed as the snapshot's own
 * keys, so a field cannot be renamed in an interface without failing to compile here.
 */
const CLIENT_FIELDS: readonly (keyof ClientSnapshot)[] = [
  'status',
  'activationDateOffset',
  'officeId',
  'displayName',
  'loanAccountCount',
  'savingsAccountCount',
  'identifierCount',
];

/** {@link LoanSnapshot}'s compared fields, in comparison order. */
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

/** {@link SavingsSnapshot}'s compared fields, in comparison order. */
const SAVINGS_FIELDS: readonly (keyof SavingsSnapshot)[] = [
  'status',
  'accountBalance',
  'totalDeposits',
  'totalWithdrawals',
];

/**
 * A snapshot field as a comparable JSON value. The fields this module produces are scalars, so anything
 * else is a malformed input from outside; it is rendered as text rather than thrown on, because a
 * comparison the harness could not complete is a finding in its own right, not a crash.
 */
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

/**
 * Compares one section of two snapshots field by field, pushing a {@link StateDiff} per difference.
 *
 * A section present on one side only is not special-cased: the absent side reads `null` for every field,
 * so it yields one entry per field that carries a value. Two absent sections agree and yield nothing.
 */
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

/**
 * Compares the two front ends' end states (AAP 0.10.1 criterion 4; AAP 0.10.2). An empty array is
 * parity.
 *
 * `project`, `workflow` and `runDate` are ignored on purpose: they are metadata about the run, not the
 * outcome, and they differ between the two runs by construction — the legacy run is a different project
 * writing a different file. Comparing them would report a difference for every workflow. Both sides are
 * taken as a {@link StateSnapshot}, the document on disk, which carries no other field to ignore.
 *
 * Nothing here throws: a section that is not an object, or a field of another type, is reported as a
 * difference rather than failing the comparison.
 *
 * @param legacy The legacy baseline's snapshot.
 * @param next The new application's snapshot.
 * @returns One entry per difference, ordered by section and then by field; empty when the two agree.
 */
export function diffStates(legacy: StateSnapshot, next: StateSnapshot): StateDiff[] {
  const differences: StateDiff[] = [];
  compareSection('client', CLIENT_FIELDS, legacy.client, next.client, differences);
  compareSection('loan', LOAN_FIELDS, legacy.loan, next.loan, differences);
  compareSection('savings', SAVINGS_FIELDS, legacy.savings, next.savings, differences);
  return differences;
}

