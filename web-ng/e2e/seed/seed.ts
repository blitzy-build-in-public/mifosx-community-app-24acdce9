/**
 * Seed of the parity fixture: the fixed test data of AAP 0.10.1 written into a freshly recreated
 * Blitzy Fineract, so the legacy baseline and the new application run W1–W8 against the same state.
 *
 * `npm run seed` (`tsx e2e/seed/seed.ts`) is the entry, and `web-ng/e2e/reset-db.sh` runs it as its
 * last step: this script is therefore the final action of a database reset and the first dependency
 * of every workflow. It talks only to the locally built `Blitzy-Sandbox/blitzy-fineract` backend at
 * `FINERACT_URL` (Rule 2) and never starts, pulls or resets a container itself — that is the reset
 * script's job.
 *
 * **It is non-idempotent by design.** Every run is expected to start from a fresh database, so a
 * rejection on an unreset database — a duplicate name, say — is the intended outcome of a second
 * run rather than a defect: the guard against it is the reset, not an upsert this script does not
 * perform (AAP 0.10.1, 0.9.4 row 13).
 *
 * Fields sent beyond the AAP 0.10.1 table, each required by the endpoint receiving it (AAP 0.9.4
 * row 13 permits exactly these, and every payload builder below carries the same list inline):
 * - staff: `isActive`.
 * - loan product: `shortName` (Fineract caps it at four characters), `digitsAfterDecimal`,
 *   `inMultiplesOf`, the enum-valued terms (`repaymentFrequencyType`, `interestRateFrequencyType`,
 *   `amortizationType`, `interestType`, `interestCalculationPeriodType`, `daysInMonthType`,
 *   `daysInYearType`), `transactionProcessingStrategyCode`, `isInterestRecalculationEnabled`,
 *   `accountingRule` and `locale`.
 * - loan charge: `chargePaymentMode`, `active` and `locale`.
 * - savings product: `shortName`, `digitsAfterDecimal`, `inMultiplesOf`, the four interest enums,
 *   `accountingRule` and `locale`.
 *
 * `locale` is the same `en` the application's `config.json` ships, taken from `./fixtures` rather
 * than re-typed: these endpoints read their amounts and counts with a locale and refuse a body that
 * omits it.
 *
 * Every enum value below is the id the running fork's own template endpoint reports
 * (`GET /loanproducts/template`, `/charges/template`, `/savingsproducts/template`), which is the
 * source of truth AAP 0.7.3 names, and each carries the enum member it encodes in a comment.
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request, type APIRequestContext } from '@playwright/test';
import { detectBackendEnvironment, type BackendEnvironment } from '../check-backend';
import {
  type ClientActionReasonSeed,
  FINERACT_URL,
  LOCALE,
  SEED_CLIENT_ACTION_GATE,
  SEED_CLIENT_ACTION_REASONS,
  SEED_LOAN_CHARGE,
  SEED_LOAN_PRODUCT,
  SEED_SAVINGS_PRODUCT,
  SEED_STAFF,
  TENANT_ID,
  apiHeaders,
  apiUrl,
  authenticate,
  readBusinessDate,
  readCredentials,
} from './fixtures';
import { resolveCliIntent, type CliUsage } from '../../tools/parity/lib/cli';

/** One entity the seed created: the name the plan fixes and the id Fineract assigned it. */
export interface SeedEntityResult {
  /** Display name of the entity, as the AAP 0.10.1 table and the workflows name it. */
  readonly name: string;
  /** Primary key Fineract returned for it, which the page objects read back through the API. */
  readonly id: number;
}

/** The four entities the seed creates, in creation order. */
export interface SeedEntities {
  /**
   * `Officer, Parity` — the loan officer the loan workflows select, the name Fineract composes from
   * the AAP 0.10.1 first and last names.
   */
  readonly staff: SeedEntityResult;
  /** `Parity Loan` — the product W4, W5, W6 and W7 use (AAP 0.10.1). */
  readonly loanProduct: SeedEntityResult;
  /** `Parity Fee` — the charge the loan-charges workflow applies (AAP 0.10.1). */
  readonly loanCharge: SeedEntityResult;
  /** `Parity Savings` — the product W8 uses (AAP 0.10.1). */
  readonly savingsProduct: SeedEntityResult;
}

/**
 * The narration values the seed created for the client lifecycle actions, one per action that takes a
 * reason. Their ids are what a `close`, `reject` or `withdraw` body submits, so a later tool reads them
 * from here instead of listing every code again.
 */
export interface SeedClientActionReasons {
  /** Value created under `ClientClosureReason`, which the close action offers. */
  readonly closure: SeedEntityResult;
  /** Value created under `ClientRejectReason`, which the reject action offers. */
  readonly rejection: SeedEntityResult;
  /** Value created under `ClientWithdrawReason`, which the withdraw action offers. */
  readonly withdrawal: SeedEntityResult;
}

/**
 * The client-action datatable gate the seed registered: the table the gate's second call reads, and the
 * check that makes it read it. The table's identity is its name — `POST /datatables` answers a name, not
 * an id — while the check is identified by the id Fineract assigned it.
 */
export interface SeedClientActionGate {
  /** Registered datatable name, e.g. `client_action_check`. */
  readonly datatableName: string;
  /** Entity the table hangs off — `m_client`. */
  readonly apptableName: string;
  /** Status the check is registered for: `600`, CLOSE. */
  readonly checkStatus: number;
  /** Id Fineract assigned the entity-datatable check. */
  readonly checkId: number;
}

/**
 * What one seed run produced, written to `web-ng/e2e/.captures/seed.json` so a later tool reads the
 * ids without querying Fineract again. It carries no credential, no authentication key and no raw
 * response body (Rule 1 clause 9).
 */
export interface SeedResult {
  /** Backend the seed wrote to, so a report can prove which one was seeded (Rule 2). */
  readonly fineractUrl: string;
  /** Tenant the entities belong to. */
  readonly tenantId: string;
  /** Verification environment, from the shared `detectBackendEnvironment` in `../check-backend`. */
  readonly environment: BackendEnvironment;
  /** When the seed ran, as an ISO-8601 timestamp — a wall clock, used for provenance only. */
  readonly seededAt: string;
  /** The run date the seed read from Fineract, as `yyyy-mm-dd` (Rule 1 clause 2). */
  readonly runDate: string;
  /** The four entities, in creation order. */
  readonly entities: SeedEntities;
  /** The client-action narration values, in code order: closure, rejection, withdrawal. */
  readonly clientActionReasons: SeedClientActionReasons;
  /** The client-action datatable and the check registered for it. */
  readonly clientActionGate: SeedClientActionGate;
}

/** Response statuses `POST` accepts: Fineract answers 200 or 201 for every resource this seed creates. */
const SUCCESS_STATUSES: readonly number[] = [200, 201];

/** Where the run's result is written; resolved from this module, so the working directory is irrelevant. */
const RESULT_ARTEFACT_URL = new URL('../.captures/seed.json', import.meta.url);

/**
 * The public demo Fineract servers the harness must never talk to (Rule 2), written as escaped-dot
 * patterns anchored on a label boundary: each one matches its host itself and any subdomain of it.
 * A refused address is rejected before the first network call.
 */
const FORBIDDEN_BACKEND_HOSTS: readonly RegExp[] = [/(^|\.)demo\.mifos\.io$/, /(^|\.)demo\.fineract\.dev$/];

/** Body of `POST /staff`. `officeId`, the two names and the loan-officer flag come from the plan. */
interface StaffCreateBody {
  readonly officeId: number;
  readonly firstname: string;
  readonly lastname: string;
  readonly isLoanOfficer: boolean;
  /** API-required addition: `POST /staff` does not default the flag, so the officer is created active. */
  readonly isActive: boolean;
}

/** Body of `POST /loanproducts`: the AAP 0.10.1 terms plus the terms the endpoint requires. */
interface LoanProductCreateBody {
  readonly name: string;
  /** API-required addition: Fineract rejects a product without a short name, and caps it at 4 characters. */
  readonly shortName: string;
  readonly currencyCode: string;
  /** API-required addition: currency precision, 2 for USD as the template's `currencyOptions` report it. */
  readonly digitsAfterDecimal: number;
  /** API-required addition: no multiple-of restriction, i.e. any amount is accepted. */
  readonly inMultiplesOf: number;
  readonly principal: number;
  readonly minPrincipal: number;
  readonly maxPrincipal: number;
  readonly numberOfRepayments: number;
  readonly repaymentEvery: number;
  /** API-required addition: `2` — MONTHS (`repaymentFrequencyTypeOptions`). */
  readonly repaymentFrequencyType: number;
  readonly interestRatePerPeriod: number;
  /** API-required addition: `3` — PER_YEARS (`interestRateFrequencyTypeOptions`). */
  readonly interestRateFrequencyType: number;
  /** API-required addition: `0` — EQUAL_PRINCIPAL (`amortizationTypeOptions`). */
  readonly amortizationType: number;
  /** API-required addition: `1` — FLAT (`interestTypeOptions`). */
  readonly interestType: number;
  /** API-required addition: `1` — SAME_AS_REPAYMENT_PERIOD (`interestCalculationPeriodTypeOptions`). */
  readonly interestCalculationPeriodType: number;
  /** API-required addition: the strategy code the repository accepts in place of the legacy numeric id. */
  readonly transactionProcessingStrategyCode: string;
  /** API-required addition: `1` — ACTUAL days in a month (`daysInMonthTypeOptions`). */
  readonly daysInMonthType: number;
  /** API-required addition: `1` — ACTUAL days in a year (`daysInYearTypeOptions`). */
  readonly daysInYearType: number;
  /** API-required addition: the endpoint requires the recalculation flag explicitly, even when false. */
  readonly isInterestRecalculationEnabled: boolean;
  /** API-required addition: `1` — NONE, because the plan configures no accounting (`accountingRuleOptions`). */
  readonly accountingRule: number;
  /** API-required addition: the endpoint reads its terms with a locale and refuses a body that omits it. */
  readonly locale: string;
}

/** Body of `POST /charges`: the AAP 0.10.1 charge plus the two fields the endpoint requires. */
interface LoanChargeCreateBody {
  readonly name: string;
  readonly currencyCode: string;
  readonly amount: number;
  /** API-required addition: `1` — LOAN (`chargeAppliesToOptions`). */
  readonly chargeAppliesTo: number;
  /** API-required addition: `2` — SPECIFIED_DUE_DATE (`loanChargeTimeTypeOptions`). */
  readonly chargeTimeType: number;
  /** API-required addition: `1` — FLAT (`loanChargeCalculationTypeOptions`). */
  readonly chargeCalculationType: number;
  /** API-required addition: `0` — REGULAR, paid directly rather than by account transfer. */
  readonly chargePaymentMode: number;
  /** API-required addition: the charge must be active to be offered by the loan charge template. */
  readonly active: boolean;
  /** API-required addition: the endpoint reads the amount with a locale and refuses a body that omits it. */
  readonly locale: string;
}

/** Body of `POST /savingsproducts`: the AAP 0.10.1 product plus the fields the endpoint requires. */
interface SavingsProductCreateBody {
  readonly name: string;
  /** API-required addition: Fineract rejects a product without a short name, and caps it at 4 characters. */
  readonly shortName: string;
  readonly currencyCode: string;
  /** API-required addition: currency precision, 2 for USD as the template's `currencyOptions` report it. */
  readonly digitsAfterDecimal: number;
  /** API-required addition: no multiple-of restriction. */
  readonly inMultiplesOf: number;
  readonly nominalAnnualInterestRate: number;
  /** API-required addition: `1` — DAILY (`interestCompoundingPeriodTypeOptions`). */
  readonly interestCompoundingPeriodType: number;
  /** API-required addition: `4` — MONTHLY (`interestPostingPeriodTypeOptions`). */
  readonly interestPostingPeriodType: number;
  /** API-required addition: `1` — DAILY_BALANCE (`interestCalculationTypeOptions`). */
  readonly interestCalculationType: number;
  /** API-required addition: `365` — DAYS_365 (`interestCalculationDaysInYearTypeOptions`). */
  readonly interestCalculationDaysInYearType: number;
  /** API-required addition: `1` — NONE, because the plan configures no accounting (`accountingRuleOptions`). */
  readonly accountingRule: number;
  /** API-required addition: the endpoint reads the rate with a locale and refuses a body that omits it. */
  readonly locale: string;
}

/** Body of `POST /codes/name/{codeName}/codevalues`: one narration value under an existing code. */
interface CodeValueCreateBody {
  /** Value name, from {@link ClientActionReasonSeed.valueName}. */
  readonly name: string;
  /** `true`, because an inactive value is not offered by the action templates this fixture serves. */
  readonly isActive: boolean;
  /** Place in the code's value list: `1`, the seed creating one value per code. */
  readonly position: number;
}

/** One column of `POST /datatables`, in the shape that endpoint declares one. */
interface DatatableColumnBody {
  readonly name: string;
  readonly type: string;
  readonly length: number;
  readonly mandatory: boolean;
}

/** Body of `POST /datatables`: the client datatable the datatable gate reads under its check. */
interface DatatableCreateBody {
  readonly datatableName: string;
  readonly apptableName: string;
  /** API-required addition: mandatory on this fork's create body, which refuses a body without it. */
  readonly entitySubType: string;
  readonly multiRow: boolean;
  readonly columns: readonly DatatableColumnBody[];
}

/**
 * Body of `POST /entityDatatableChecks`: the check that makes the gate read the table before a client
 * action whose status it names.
 */
interface EntityDatatableCheckCreateBody {
  /** Entity the check applies to — `m_client`, the client entity. */
  readonly entity: string;
  /** Client status the check is registered for: `600`, CLOSE. */
  readonly status: number;
  /** Datatable the gate then reads for that client. */
  readonly datatableName: string;
}

/**
 * A `POST` Fineract refused. Carries the failing resource path, the status and Fineract's own
 * `errors[].defaultUserMessage` texts, which are what the operator needs to correct the payload; it
 * never carries the authentication key or the request headers (Rule 1 clause 9).
 */
class SeedRequestError extends Error {
  /** Resource path below the API path, e.g. `/loanproducts`. */
  readonly path: string;
  /** HTTP status Fineract answered with. */
  readonly status: number;
  /** Fineract's validation messages, empty when it answered without any. */
  readonly validationMessages: readonly string[];

  constructor(path: string, status: number, validationMessages: readonly string[]) {
    super(`POST ${path} failed with HTTP ${status}`);
    this.name = 'SeedRequestError';
    this.path = path;
    this.status = status;
    this.validationMessages = validationMessages;
  }
}

/**
 * Re-throws a failed run with every known secret masked. A {@link SeedRequestError} already carries
 * only the resource path, the status and Fineract's own validation messages, so it passes through
 * unchanged; every other failure is reduced to its message with {@link redactAuthentication} applied.
 *
 * @param error Whatever the run threw.
 * @param secrets Known secret values to mask.
 */
function redactFailure(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof SeedRequestError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactAuthentication(message, secrets));
}

/** Narrows a parsed JSON payload to an object, which is the only shape Fineract's resources return. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a non-empty string field, or `null` when the field is absent or not a string. */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Collects every message Fineract itself reports for a refused call: the top-level
 * `defaultUserMessage` and each `errors[].defaultUserMessage`. Anything else in the body is ignored,
 * because Fineract's own messages are what the operator can act on (AAP 0.4.4 item 6).
 */
function collectValidationMessages(body: unknown): string[] {
  if (!isRecord(body)) {
    return [];
  }
  const messages: string[] = [];
  const topLevel = readText(body['defaultUserMessage']);
  if (topLevel !== null) {
    messages.push(topLevel);
  }
  const errors = body['errors'];
  if (Array.isArray(errors)) {
    // `Array.isArray` narrows to `any[]`; reading each entry as `unknown` keeps the element-by-element
    // check explicit instead of trusting the array's element type (Rule 1 clause 4).
    for (const entry of errors as readonly unknown[]) {
      const message = isRecord(entry) ? readText(entry['defaultUserMessage']) : null;
      if (message !== null && !messages.includes(message)) {
        messages.push(message);
      }
    }
  }
  return messages;
}

/**
 * One accepted `POST`: the status Fineract answered with and its parsed body, unread. The pair is what
 * the readers below need, because the resources this seed writes do not all answer their identifier the
 * same way — `POST /datatables` answers the table's name and no id at all.
 */
interface SeedPostResult {
  /** Status Fineract answered with; one of {@link SUCCESS_STATUSES}. */
  readonly status: number;
  /** Parsed JSON body, `unknown` because it crosses the HTTP boundary. */
  readonly body: unknown;
}

/**
 * Reads one positive integer id field of an accepted response.
 *
 * @param result Status and body of the accepted `POST`.
 * @param field Id member to read: `resourceId` or `subResourceId`.
 * @param path Resource path that produced it, named in the error message.
 * @throws When the body carries no usable value under `field`, which means the id cannot be recorded
 * and every later workflow would run against an unknown record.
 */
function readIdentifier(
  result: SeedPostResult,
  field: 'resourceId' | 'subResourceId',
  path: string,
): number {
  const id = isRecord(result.body) ? result.body[field] : undefined;
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
    return id;
  }
  throw new Error(`POST ${path} (HTTP ${result.status}) answered without a usable ${field}.`);
}

/**
 * Reads the `resourceId` of a created entity — the id of the resource the path names.
 *
 * @param result Status and body of the accepted `POST`.
 * @param path Resource path that produced it, named in the error message.
 * @throws When the body carries no usable `resourceId` (see {@link readIdentifier}).
 */
function readResourceId(result: SeedPostResult, path: string): number {
  return readIdentifier(result, 'resourceId', path);
}

/**
 * Reads the `subResourceId` of a value created under another resource — the id of a new code value,
 * where `POST /codes/name/{codeName}/codevalues` answers `{resourceId: <code id>, subResourceId:
 * <value id>}`. Reading `resourceId` here would record the parent code's id as the reason a `close`
 * submits, which Fineract would then refuse as a value the code does not hold.
 *
 * @param result Status and body of the accepted `POST`.
 * @param path Resource path that produced it, named in the error message.
 * @throws When the body carries no usable `subResourceId` (see {@link readIdentifier}).
 */
function readSubResourceId(result: SeedPostResult, path: string): number {
  return readIdentifier(result, 'subResourceId', path);
}

/**
 * Parses a response body, reporting what was received when it is not JSON.
 *
 * @param text Raw response body.
 * @param source What was called and with which status, used in the error message.
 */
function parseJsonBody(text: string, source: string): unknown {
  try {
    // `JSON.parse` answers `any`; widening it to `unknown` is the boundary each caller narrows
    // through isRecord/readText/readResourceId, which keeps `any` out of this module (Rule 1 clause 4).
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source} did not answer with JSON. Observed body: ${text.slice(0, 500)}`);
  }
}

/**
 * Refuses a backend the harness must never talk to (Rule 2): a public Mifos or Fineract demo server,
 * and any subdomain of one. Runs before the first network call, so a misconfigured `FINERACT_URL`
 * can never authenticate against a public server or write fixture data to one.
 *
 * @param baseUrl The configured base address, `FINERACT_URL` from `./fixtures`.
 * @throws When the address is not a URL, or its host is a refused one. The message names Rule 2.
 */
function assertPermittedBackend(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(`Rule 2 requires a Fineract address; "${baseUrl}" is not a URL.`);
  }
  const refused = FORBIDDEN_BACKEND_HOSTS.some((forbidden) => forbidden.test(host));
  if (refused) {
    throw new Error(
      `Rule 2 forbids pointing the harness at a public demo server: ${host} is not a permitted backend. ` +
        'Run the locally built Blitzy-Sandbox/blitzy-fineract and set FINERACT_URL to it.',
    );
  }
}

/** Formats a run date as `yyyy-mm-dd`, reading the UTC day so no host timezone can shift it. */
function toIsoDay(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** What authentication material is replaced with before any error text is printed (Rule 1 clause 9). */
const REDACTED = '***';

/**
 * Masks authentication material in text that is about to reach stderr.
 *
 * A Playwright request error quotes the request it could not send — headers and body included — so an
 * unreachable backend would otherwise print `Authorization: Basic <key>` or the password into test
 * output, which Rule 1 clause 9 forbids. Each known secret is replaced, and so is any `Authorization`
 * header or `Basic` credential the message carries from a request this module did not build.
 *
 * @param text The message to print.
 * @param secrets Known secret values: the password and the authentication key, when they are known.
 */
function redactAuthentication(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  redacted = redacted.replace(/authorization:[^\r\n]*/gi, `authorization: ${REDACTED}`);
  redacted = redacted.replace(/\bbasic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`);
  return redacted;
}

/**
 * Body of `POST /staff` for the AAP 0.10.1 row "Parity Officer, loan officer, office 1 (Head
 * Office)". Only `isActive` is added to it, because the endpoint will not default the flag.
 */
function staffCreateBody(): StaffCreateBody {
  return {
    officeId: SEED_STAFF.officeId,
    firstname: SEED_STAFF.firstname,
    lastname: SEED_STAFF.lastname,
    isLoanOfficer: SEED_STAFF.isLoanOfficer,
    isActive: true,
  };
}

/**
 * Body of `POST /loanproducts` for the AAP 0.10.1 row "Parity Loan, currency USD, principal min
 * 1,000, default 5,000, max 10,000, 12 monthly repayments, flat interest 12% per year".
 *
 * The terms the row names come from {@link SEED_LOAN_PRODUCT}; every other field is one the endpoint
 * requires, and each enum carries the member name the fork's `loanproducts/template` reports for it.
 * No product charge is attached: the AAP 0.10.1 table defines `Parity Fee` as a standalone charge,
 * and attaching one to a loan is the application's own in-scope action (`POST /loans/{id}/charges`).
 */
function loanProductCreateBody(): LoanProductCreateBody {
  return {
    name: SEED_LOAN_PRODUCT.name,
    shortName: 'PARL',
    currencyCode: SEED_LOAN_PRODUCT.currencyCode,
    digitsAfterDecimal: 2,
    inMultiplesOf: 0,
    principal: SEED_LOAN_PRODUCT.principal,
    minPrincipal: SEED_LOAN_PRODUCT.minPrincipal,
    maxPrincipal: SEED_LOAN_PRODUCT.maxPrincipal,
    numberOfRepayments: SEED_LOAN_PRODUCT.numberOfRepayments,
    repaymentEvery: SEED_LOAN_PRODUCT.repaymentEveryMonths,
    repaymentFrequencyType: 2, // MONTHS
    interestRatePerPeriod: SEED_LOAN_PRODUCT.interestRatePerYear,
    interestRateFrequencyType: 3, // PER_YEARS
    amortizationType: 0, // EQUAL_PRINCIPAL
    interestType: 1, // FLAT
    interestCalculationPeriodType: 1, // SAME_AS_REPAYMENT_PERIOD
    transactionProcessingStrategyCode: 'mifos-standard-strategy',
    daysInMonthType: 1, // ACTUAL
    daysInYearType: 1, // ACTUAL
    isInterestRecalculationEnabled: false,
    accountingRule: 1, // NONE
    locale: LOCALE,
  };
}

/**
 * Body of `POST /charges` for the AAP 0.10.1 row "Parity Fee, flat amount 25, specified due date".
 *
 * It creates the charge definition only. The due date the row names is supplied when the charge is
 * applied to a loan, so nothing date-bearing is sent here (Rule 1 clause 3).
 *
 * The payment mode stays REGULAR and this fixture deliberately carries no second charge with
 * ACCOUNT_TRANSFER. The fork pays a loan charge only when it is an account-transfer charge on a loan
 * that carries a linked savings account: `payLoanCharge` refuses every other payment mode, and applying
 * an account-transfer charge at all answers 403 `error.msg.loanCharge.add.requires.linked.account` until
 * that link exists. The link comes from a loan application's `linkAccountId` member or from
 * `PUT /loans/{id}` before approval, so it needs a savings account the client already owns; a second
 * charge would appear in the add-charge template while every attempt to apply it was refused. Leaving it
 * out keeps the fixture's charges usable, and the charge-pay refusal stays the fork's own answer on both
 * front ends, which is what the parity comparison measures.
 */
function loanChargeCreateBody(): LoanChargeCreateBody {
  return {
    name: SEED_LOAN_CHARGE.name,
    currencyCode: SEED_LOAN_CHARGE.currencyCode,
    amount: SEED_LOAN_CHARGE.amount,
    chargeAppliesTo: 1, // LOAN
    chargeTimeType: 2, // SPECIFIED_DUE_DATE
    chargeCalculationType: 1, // FLAT
    chargePaymentMode: 0, // REGULAR
    active: true,
    locale: LOCALE,
  };
}

/**
 * Body of `POST /savingsproducts` for the AAP 0.10.1 row "Parity Savings, currency USD, nominal
 * annual interest 2%". The interest enums are the fork's own defaults for a passbook-style account,
 * each named in a comment beside it.
 */
function savingsProductCreateBody(): SavingsProductCreateBody {
  return {
    name: SEED_SAVINGS_PRODUCT.name,
    shortName: 'PARS',
    currencyCode: SEED_SAVINGS_PRODUCT.currencyCode,
    digitsAfterDecimal: 2,
    inMultiplesOf: 0,
    nominalAnnualInterestRate: SEED_SAVINGS_PRODUCT.nominalAnnualInterestRate,
    interestCompoundingPeriodType: 1, // DAILY
    interestPostingPeriodType: 4, // MONTHLY
    interestCalculationType: 1, // DAILY_BALANCE
    interestCalculationDaysInYearType: 365, // DAYS_365
    accountingRule: 1, // NONE
    locale: LOCALE,
  };
}

/**
 * Body of `POST /codes/name/{codeName}/codevalues` for one client-action narration value. The AAP
 * 0.10.1 table fixes no reason and a freshly migrated database carries no value under any code, so the
 * seed creates one per narration code and the action templates then offer it. Only the value's name
 * comes from the fixture; `isActive` and `position` are what the endpoint requires of a value a screen
 * can offer, and the seed creates one value per code, which therefore leads the code's list.
 */
function codeValueCreateBody(reason: ClientActionReasonSeed): CodeValueCreateBody {
  return { name: reason.valueName, isActive: true, position: 1 };
}

/**
 * Body of `POST /datatables` for the client-action gate: the client datatable the gate's second call
 * reads under the check. Every value is the fixture's, and `entitySubType` is sent because this fork's
 * create body refuses a payload without it.
 */
function clientActionDatatableCreateBody(): DatatableCreateBody {
  return {
    datatableName: SEED_CLIENT_ACTION_GATE.datatableName,
    apptableName: SEED_CLIENT_ACTION_GATE.apptableName,
    entitySubType: SEED_CLIENT_ACTION_GATE.entitySubType,
    multiRow: SEED_CLIENT_ACTION_GATE.multiRow,
    columns: [
      {
        name: SEED_CLIENT_ACTION_GATE.column.name,
        type: SEED_CLIENT_ACTION_GATE.column.type,
        length: SEED_CLIENT_ACTION_GATE.column.length,
        mandatory: SEED_CLIENT_ACTION_GATE.column.mandatory,
      },
    ],
  };
}

/**
 * Body of `POST /entityDatatableChecks` for the client-action gate: the check that makes the gate read
 * the datatable before a client action whose status it names.
 */
function clientActionCheckCreateBody(): EntityDatatableCheckCreateBody {
  return {
    entity: SEED_CLIENT_ACTION_GATE.apptableName,
    status: SEED_CLIENT_ACTION_GATE.checkStatus,
    datatableName: SEED_CLIENT_ACTION_GATE.datatableName,
  };
}

/**
 * Parses a body when it is JSON and answers `undefined` when it is not, so a failed `POST` can report
 * the status it saw instead of throwing on the way to the message that matters.
 */
function parseFailureBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Sends one `POST` — the single request helper every step of {@link runSeed} goes through — and answers
 * the status Fineract accepted it with and its parsed body. Reading the id is the caller's job, through
 * {@link readResourceId} or {@link readSubResourceId}, because the resources this seed writes identify
 * what they created differently.
 *
 * @param context Request context carrying the tenant header and the basic-auth credential.
 * @param path Resource path below the API path, e.g. `/loanproducts`.
 * @param body Typed request body of that resource.
 * @returns The accepted status and the parsed body.
 * @throws {@link SeedRequestError} on any status other than 200 or 201, carrying Fineract's own
 * validation messages; or an `Error` when a successful response does not carry JSON. Nothing is
 * swallowed and no caller continues after a failure: `npm run seed` must exit non-zero if any one call
 * of the run fails (AAP 0.10.4, criteria 3 and 12).
 */
async function post(context: APIRequestContext, path: string, body: unknown): Promise<SeedPostResult> {
  const url = apiUrl(path);
  const response = await context.post(url, { data: body });
  const status = response.status();
  const text = await response.text();
  if (!SUCCESS_STATUSES.includes(status)) {
    const messages = collectValidationMessages(parseFailureBody(text));
    throw new SeedRequestError(
      path,
      status,
      messages.length > 0 ? messages : [`Fineract answered: ${text.slice(0, 300) || '(empty body)'}`],
    );
  }
  return { status, body: parseJsonBody(text, `POST ${url} (HTTP ${status})`) };
}

/**
 * Creates one active narration value under its code and answers the value's own id: `POST
 * /codes/name/{codeName}/codevalues`, keyed by the code's name so the step needs no `GET /codes` lookup
 * and no numeric code id the tenant's migration assigned. The value's id is the answer's
 * `subResourceId`; its `resourceId` is the parent code.
 *
 * @param context Request context carrying the tenant header and the basic-auth credential.
 * @param reason Code name and value name to create.
 * @returns The created value's name and the id a client action submits as its reason.
 * @throws {@link SeedRequestError} when Fineract refuses the write, or an `Error` when the answer
 * carries no usable `subResourceId`.
 */
async function createClientActionReason(
  context: APIRequestContext,
  reason: ClientActionReasonSeed,
): Promise<SeedEntityResult> {
  const path = '/codes/name/' + reason.codeName + '/codevalues';
  const created = await post(context, path, codeValueCreateBody(reason));
  return { name: reason.valueName, id: readSubResourceId(created, path) };
}

/**
 * Creates one entity and answers the id Fineract assigned: {@link post} followed by
 * {@link readResourceId}, for the resources that answer their own `resourceId` — the staff member, both
 * products and the charge.
 *
 * @param context Request context carrying the tenant header and the basic-auth credential.
 * @param path Resource path below the API path, e.g. `/loanproducts`.
 * @param body Typed request body of that resource.
 * @returns The id Fineract assigned.
 * @throws {@link SeedRequestError} when Fineract refuses the write, or an `Error` when the answer
 * carries no usable `resourceId`.
 */
async function createEntity(context: APIRequestContext, path: string, body: unknown): Promise<number> {
  return readResourceId(await post(context, path, body), path);
}

/**
 * Registers the client datatable and its entity-datatable check — the fixture the datatable gate needs
 * before it can read anything: with no check registered, `GET /entityDatatableChecks?limit=-1` answers
 * no rows and the gate is an unverifiable pass-through.
 *
 * Both writes are named by their contract: `POST /datatables` is the fork's
 * `DatatablesApiResource.createDatatable`, and `POST /entityDatatableChecks` is its
 * `createEntityDatatableCheck`. Only the datatable write is declared in `harness-allowlist.json`,
 * because only it is a URL the application never calls. The check's URL is already declared in
 * `endpoint-allowlist.json` for the gate's own `GET /entityDatatableChecks`, and AAP 0.10.4 keeps the
 * harness list to what the app never does — `npm run check:endpoints` fails a harness row whose path
 * the app list also declares, and the seed's write resolves against that existing declaration.
 *
 * The check's status is CLOSE (600) rather than ACTIVATE (300) on purpose. The legacy client-action
 * controller gates `m_client` on ACTIVATE and on CLOSE, and when a check's table holds no row for the
 * client it renders the datatable's fields and posts a row before performing the action
 * (`submitDatatable`). A W2 client has no row, so an ACTIVATE check would add a
 * `POST /datatables/{table}/{id}` to legacy's W2 and none to the new app's, which would break the parity
 * request comparison for a Must workflow. CLOSE leaves W2 identical on both front ends — each lists the
 * checks and filters this one out — while making the check row, the datatable and the gate's two-call
 * read observable on the in-scope close screen.
 *
 * @param context Request context carrying the tenant header and the basic-auth credential.
 * @returns The registered table's name, the entity it hangs off, the check's status and its id.
 * @throws {@link SeedRequestError} when Fineract refuses either write, or an `Error` when the check's
 * answer carries no usable `resourceId`.
 */
async function createClientActionGate(context: APIRequestContext): Promise<SeedClientActionGate> {
  await post(context, '/datatables', clientActionDatatableCreateBody());
  const checkPath = '/entityDatatableChecks';
  const check = await post(context, checkPath, clientActionCheckCreateBody());
  return {
    datatableName: SEED_CLIENT_ACTION_GATE.datatableName,
    apptableName: SEED_CLIENT_ACTION_GATE.apptableName,
    checkStatus: SEED_CLIENT_ACTION_GATE.checkStatus,
    checkId: readResourceId(check, checkPath),
  };
}

/**
 * Removes the artefact an earlier run wrote, so no consumer can read a previous run's ids once this run
 * has started. {@link runSeed} calls it before anything else — before the backend is vetted and before
 * the first request — because every failure path after that point (a refused host, missing credentials,
 * an unreachable backend, a rejected `POST`, a crash) must leave no readable artefact behind. The
 * artefact's contract is "what one seed run produced", and ids from a run that did not finish are worse
 * than none: on a recreated database they name records that no longer exist, so a seed failure would
 * surface downstream as an unrelated missing-record error.
 *
 * An absent artefact is not a failure — a first run has nothing to remove — and the temporary file of an
 * interrupted atomic write is not this artefact, so {@link writeResultArtefact} stays the only writer and
 * cleaner of `seed.json.tmp`. Any other removal failure (a permission, a directory sitting at the path)
 * propagates as the run's failure: a run must not report success, or carry on seeding, past a stale
 * artefact it could not remove (AAP 0.14.2, "no `catch` swallows an error silently"). A `--help`
 * invocation never reaches it, because the CLI answers usage before {@link runSeed} is called.
 *
 * @throws When the artefact exists and cannot be removed.
 */
export async function discardResultArtefact(): Promise<void> {
  await rm(fileURLToPath(RESULT_ARTEFACT_URL), { force: true });
}

/**
 * Writes the run's result to `web-ng/e2e/.captures/seed.json`, the one artefact this script produces.
 * The directory is git-ignored by `web-ng/.gitignore` (`/e2e/.captures`), and the file holds ids,
 * names, addresses and the run date only — never a credential, an authentication key or a raw
 * response body (Rule 1 clause 9).
 *
 * The write is atomic, so that a consumer reading the artefact beside this script never sees a
 * half-written document and never has to detect one: the serialised JSON goes to `seed.json.tmp` in
 * the same directory and that file is then renamed onto `seed.json`, which within one filesystem
 * replaces the artefact in a single step. A reader racing the run, or a crash part-way through it,
 * therefore finds the previous artefact complete or the new one complete, never a truncated file. A
 * failed write or rename removes the temporary file rather than leaving a partial one beside the
 * artefact, and the failure itself is rethrown so the run still exits non-zero.
 *
 * @param result The provenance and ids of the run.
 * @throws When the directory cannot be created, the document cannot be written, or the temporary
 * file cannot be renamed into place. The error's own message is preserved.
 */
async function writeResultArtefact(result: SeedResult): Promise<void> {
  const path = fileURLToPath(RESULT_ARTEFACT_URL);
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    // `force` treats an already-absent temporary file as success, and a second failure here is
    // swallowed so the error the caller sees is the write or rename that actually failed.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * One line per created record, in creation order — what a successful run prints and nothing more. The
 * narration values follow the four entities because their ids are what a client action submits, and the
 * datatable gate closes the list because its check is what a client action is measured against: an
 * operator diagnosing a refused `close`, `reject` or `withdraw` reads both here instead of opening the
 * artefact.
 */
function entityLines(result: SeedResult): string[] {
  return [
    `staff: ${result.entities.staff.name} id=${result.entities.staff.id}`,
    `loan product: ${result.entities.loanProduct.name} id=${result.entities.loanProduct.id}`,
    `loan charge: ${result.entities.loanCharge.name} id=${result.entities.loanCharge.id}`,
    `savings product: ${result.entities.savingsProduct.name} id=${result.entities.savingsProduct.id}`,
    `closure reason: ${result.clientActionReasons.closure.name} id=${result.clientActionReasons.closure.id}`,
    `rejection reason: ${result.clientActionReasons.rejection.name} id=${result.clientActionReasons.rejection.id}`,
    `withdrawal reason: ${result.clientActionReasons.withdrawal.name} id=${result.clientActionReasons.withdrawal.id}`,
    `client action gate: ${result.clientActionGate.datatableName} on ${result.clientActionGate.apptableName} status=${result.clientActionGate.checkStatus} check id=${result.clientActionGate.checkId}`,
  ];
}

/** Turns whatever a failed run threw into the lines printed to stderr. */
function describeFailure(error: unknown): string[] {
  if (error instanceof SeedRequestError) {
    return [error.message, ...error.validationMessages.map((message) => `  - ${message}`)];
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return [String(error)];
}

/**
 * Seeds the fixed parity data and reports what it created — the module's one entry point, called by
 * the CLI below and by nothing else.
 *
 * Order is fixed, one call at a time: staff, loan product, loan charge, savings product, then the three
 * client-action narration values, then the client datatable with its entity-datatable check. The loan
 * product and the charge must both exist before any loan workflow runs, and a failure on one step
 * aborts the run rather than leaving a half-seeded database to be discovered by a spec.
 *
 * Everything after the four AAP 0.10.1 entities exists because the client lifecycle actions of AAP
 * 0.9.1 row 2 cannot be produced without it: an action offers a reason only once a value exists under
 * its code, and it passes the datatable gate only once a check and its table are registered. Without
 * both, `close`, `reject`, `withdraw` and the `reactivate` that follows a close are unreachable on a
 * freshly migrated database.
 *
 * The run date is read once from Fineract (`readBusinessDate`) and recorded in the result, so every
 * workflow that consumes this artefact derives its dates from the tenant's business date rather than
 * the browser clock (Rule 1 clause 2). The read is handed the key this run already authenticated
 * with, so a run authenticates exactly once and the only key that crosses the boundary is the one
 * registered above for masking (Rule 1 clause 9). None of these payloads carries a date of its own.
 *
 * The artefact is invalidated first: the run removes whatever `web-ng/e2e/.captures/seed.json` an
 * earlier run left before it vets the backend or makes any request ({@link discardResultArtefact}), so
 * no failure below — a refused host, absent credentials, an unreachable backend, a refused `POST`, a
 * crash — can leave a previous run's ids readable by a spec or a tool.
 *
 * @returns The ids of the four entities, the three narration values, the gate it registered and the
 * provenance of the run.
 * @throws When the artefact of an earlier run cannot be removed, when the backend is a refused public
 * demo host (Rule 2), when credentials are missing, when the backend is unreachable, when any `POST` is
 * refused, or when the result cannot be written.
 * Nothing it throws carries the password or the authentication key: both are masked before the
 * message leaves this function (Rule 1 clause 9).
 */
export async function runSeed(): Promise<SeedResult> {
  // The run's first statement, before the backend is vetted and before any request: every later
  // failure path has already passed this point, so none of them can leave an earlier run's artefact
  // readable (finding qa3-F02).
  await discardResultArtefact();
  assertPermittedBackend(FINERACT_URL);
  // Read before any call so a missing variable fails immediately, naming itself, instead of
  // surfacing as an authentication error against the backend.
  const credentials = readCredentials();
  const secrets: string[] = [credentials.password];
  let context: APIRequestContext | null = null;
  try {
    const authenticationKey = await authenticate();
    secrets.push(authenticationKey);
    context = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: apiHeaders(authenticationKey),
    });
    const runDate = await readBusinessDate(authenticationKey);
    const staffId = await createEntity(context, '/staff', staffCreateBody());
    const loanProductId = await createEntity(context, '/loanproducts', loanProductCreateBody());
    const loanChargeId = await createEntity(context, '/charges', loanChargeCreateBody());
    const savingsProductId = await createEntity(context, '/savingsproducts', savingsProductCreateBody());
    const closureReason = await createClientActionReason(context, SEED_CLIENT_ACTION_REASONS.closure);
    const rejectionReason = await createClientActionReason(context, SEED_CLIENT_ACTION_REASONS.rejection);
    const withdrawalReason = await createClientActionReason(context, SEED_CLIENT_ACTION_REASONS.withdrawal);
    const clientActionGate = await createClientActionGate(context);
    const result: SeedResult = {
      fineractUrl: FINERACT_URL,
      tenantId: TENANT_ID,
      environment: detectBackendEnvironment(),
      seededAt: new Date().toISOString(),
      runDate: toIsoDay(runDate),
      entities: {
        staff: { name: SEED_STAFF.displayName, id: staffId },
        loanProduct: { name: SEED_LOAN_PRODUCT.name, id: loanProductId },
        loanCharge: { name: SEED_LOAN_CHARGE.name, id: loanChargeId },
        savingsProduct: { name: SEED_SAVINGS_PRODUCT.name, id: savingsProductId },
      },
      clientActionReasons: {
        closure: closureReason,
        rejection: rejectionReason,
        withdrawal: withdrawalReason,
      },
      clientActionGate,
    };
    await writeResultArtefact(result);
    return result;
  } catch (error) {
    throw redactFailure(error, secrets);
  } finally {
    if (context !== null) {
      await context.dispose();
    }
  }
}

/**
 * What `--help` prints (finding 406f-F02): the writes this command performs, the variables it reads —
 * named, never valued (Rule 1 clause 9) — and the two ways it is invoked.
 */
const SEED_USAGE: CliUsage = {
  name: 'seed',
  summary: 'Creates the AAP 0.10.1 parity fixtures in a freshly recreated Blitzy Fineract and records their ids in e2e/.captures/seed.json.',
  effects: [
    'writes four records, in this order: staff (POST /staff), loan product (POST /loanproducts), loan charge (POST /charges), savings product (POST /savingsproducts)',
    'writes one active narration value per client-action code (POST /codes/name/{codeName}/codevalues), so the close, reject and withdraw actions have a reason to offer: ClientClosureReason, ClientRejectReason and ClientWithdrawReason',
    'writes the client datatable client_action_check on m_client and the entity-datatable check registered for its CLOSE status (POST /datatables, then POST /entityDatatableChecks), so the client-action datatable gate has a check and a table to read',
    'writes e2e/.captures/seed.json with the ids, the tenant, the run date and the backend it wrote to',
    'is not idempotent: a second run against the same database fails on the names the first run created',
    'runs after `npm run reset:db`, against the database that reset has just recreated',
  ],
  environment: [
    'FINERACT_URL — base address of the Blitzy Fineract backend the fixtures are written to',
    'TENANT_ID — the Fineract tenant the fixtures are created in',
    'FINERACT_TENANT_ID — accepted alias of TENANT_ID',
    'E2E_USER / E2E_PASSWORD — the Fineract login the seed authenticates with',
    'FINERACT_USERNAME / FINERACT_PASSWORD — accepted aliases of E2E_USER / E2E_PASSWORD',
    'CODESPACES — set when the run happens in Codespaces, recorded as the run environment',
  ],
  examples: [
    'npm run seed',
    'npx tsx e2e/seed/seed.ts',
  ],
};

/**
 * CLI body: seeds, prints one line per created entity, and turns any failure into exit code 1 with
 * Fineract's own messages on stderr. Printing stays to ids and names, so the authentication key and
 * the password never reach the console (Rule 1 clause 9).
 */
async function main(): Promise<void> {
  // Usage is answered before runSeed(), so `--help` inspects the four writes without performing one
  // (finding 406f-F02). The code is set on process.exitCode rather than forced, so a piped line survives.
  const intent = resolveCliIntent(SEED_USAGE, process.argv.slice(2));
  if (intent.kind === 'handled') {
    process.exitCode = intent.exitCode;
    return;
  }
  try {
    const result = await runSeed();
    for (const line of entityLines(result)) {
      process.stdout.write(`${line}\n`);
    }
  } catch (error) {
    const [summary, ...details] = describeFailure(error);
    process.stderr.write(`seed failed: ${summary}\n`);
    for (const detail of details) {
      process.stderr.write(`${detail}\n`);
    }
    process.exitCode = 1;
  }
}

// Guarded entry: the script runs only when executed directly. Importing this module — which the
// Playwright loader does while collecting the suite — must stay inert, so `npx playwright test --list`
// exits 0 with no environment configured and no backend running (AAP 0.10.3).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}

