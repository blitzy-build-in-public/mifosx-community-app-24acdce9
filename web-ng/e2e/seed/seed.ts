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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request, type APIRequestContext } from '@playwright/test';
import {
  FINERACT_URL,
  LOCALE,
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

/** One entity the seed created: the name the plan fixes and the id Fineract assigned it. */
export interface SeedEntityResult {
  /** Display name of the entity, as the AAP 0.10.1 table and the workflows name it. */
  readonly name: string;
  /** Primary key Fineract returned for it, which the page objects read back through the API. */
  readonly id: number;
}

/** The four entities the seed creates, in creation order. */
export interface SeedEntities {
  /** `Parity Officer` — the loan officer the loan workflows select (AAP 0.10.1). */
  readonly staff: SeedEntityResult;
  /** `Parity Loan` — the product W4, W5, W6 and W7 use (AAP 0.10.1). */
  readonly loanProduct: SeedEntityResult;
  /** `Parity Fee` — the charge the loan-charges workflow applies (AAP 0.10.1). */
  readonly loanCharge: SeedEntityResult;
  /** `Parity Savings` — the product W8 uses (AAP 0.10.1). */
  readonly savingsProduct: SeedEntityResult;
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
  /** Verification environment, detected the way `web-ng/e2e/check-backend.ts` detects it. */
  readonly environment: 'mac' | 'codespaces';
  /** When the seed ran, as an ISO-8601 timestamp — a wall clock, used for provenance only. */
  readonly seededAt: string;
  /** The run date the seed read from Fineract, as `yyyy-mm-dd` (Rule 1 clause 2). */
  readonly runDate: string;
  /** The four entities, in creation order. */
  readonly entities: SeedEntities;
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
 * Reads the `resourceId` of a created entity — the shape every `POST` this seed makes answers with.
 *
 * @param body Parsed response body, read as `unknown` because it crosses the HTTP boundary.
 * @param path Resource path that produced it, named in the error message.
 * @param status Status that produced it, named in the error message.
 * @throws When the body carries no usable `resourceId`, which means the entity's id cannot be
 * recorded and every later workflow would run against an unknown record.
 */
function readResourceId(body: unknown, path: string, status: number): number {
  const id = isRecord(body) ? body['resourceId'] : undefined;
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
    return id;
  }
  throw new Error(`POST ${path} (HTTP ${status}) answered without a usable resourceId.`);
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

/**
 * Detects the verification environment the same way `web-ng/e2e/check-backend.ts` does: the
 * `CODESPACES` variable set to anything but `0`/`false` means Codespaces, otherwise the Mac (AAP
 * 0.10.3 keeps environment differences to variables only).
 */
function readEnvironment(): 'mac' | 'codespaces' {
  const codespaces = (process.env['CODESPACES'] ?? '').trim().toLowerCase();
  return codespaces.length > 0 && codespaces !== '0' && codespaces !== 'false' ? 'codespaces' : 'mac';
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
 * Creates one entity — the single `POST` helper every step of {@link runSeed} goes through.
 *
 * @param context Request context carrying the tenant header and the basic-auth credential.
 * @param path Resource path below the API path, e.g. `/loanproducts`.
 * @param body Typed request body of that resource.
 * @returns The id Fineract assigned.
 * @throws {@link SeedRequestError} on any status other than 200 or 201, carrying Fineract's own
 * validation messages; or an `Error` when a successful response carries no usable `resourceId`.
 * Nothing is swallowed and no caller continues after a failure: `npm run seed` must exit non-zero if
 * any one of the four calls fails (AAP 0.10.4, criteria 3 and 12).
 */
async function post(context: APIRequestContext, path: string, body: unknown): Promise<number> {
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
  return readResourceId(parseJsonBody(text, `POST ${url} (HTTP ${status})`), path, status);
}

/**
 * Writes the run's result to `web-ng/e2e/.captures/seed.json`, the one artefact this script produces.
 * The directory is git-ignored by `web-ng/.gitignore` (`/e2e/.captures`), and the file holds ids,
 * names, addresses and the run date only — never a credential, an authentication key or a raw
 * response body (Rule 1 clause 9).
 */
async function writeResultArtefact(result: SeedResult): Promise<void> {
  const path = fileURLToPath(RESULT_ARTEFACT_URL);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

/** One line per created entity, in creation order — what a successful run prints and nothing more. */
function entityLines(entities: SeedEntities): string[] {
  return [
    `staff: ${entities.staff.name} id=${entities.staff.id}`,
    `loan product: ${entities.loanProduct.name} id=${entities.loanProduct.id}`,
    `loan charge: ${entities.loanCharge.name} id=${entities.loanCharge.id}`,
    `savings product: ${entities.savingsProduct.name} id=${entities.savingsProduct.id}`,
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
 * Order is fixed: staff, then loan product, then loan charge, then savings product, one call each,
 * sequentially. The loan product and the charge must both exist before any loan workflow runs, and a
 * failure on one step aborts the run rather than leaving a half-seeded database to be discovered by a
 * spec.
 *
 * The run date is read once from Fineract (`readBusinessDate`) and recorded in the result, so every
 * workflow that consumes this artefact derives its dates from the tenant's business date rather than
 * the browser clock (Rule 1 clause 2). These four payloads carry no date of their own.
 *
 * @returns The ids of the four entities and the provenance of the run.
 * @throws When the backend is a refused public demo host (Rule 2), when credentials are missing,
 * when the backend is unreachable, when any `POST` is refused, or when the result cannot be written.
 * Nothing it throws carries the password or the authentication key: both are masked before the
 * message leaves this function (Rule 1 clause 9).
 */
export async function runSeed(): Promise<SeedResult> {
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
    const runDate = await readBusinessDate();
    const staffId = await post(context, '/staff', staffCreateBody());
    const loanProductId = await post(context, '/loanproducts', loanProductCreateBody());
    const loanChargeId = await post(context, '/charges', loanChargeCreateBody());
    const savingsProductId = await post(context, '/savingsproducts', savingsProductCreateBody());
    const result: SeedResult = {
      fineractUrl: FINERACT_URL,
      tenantId: TENANT_ID,
      environment: readEnvironment(),
      seededAt: new Date().toISOString(),
      runDate: toIsoDay(runDate),
      entities: {
        staff: { name: SEED_STAFF.displayName, id: staffId },
        loanProduct: { name: SEED_LOAN_PRODUCT.name, id: loanProductId },
        loanCharge: { name: SEED_LOAN_CHARGE.name, id: loanChargeId },
        savingsProduct: { name: SEED_SAVINGS_PRODUCT.name, id: savingsProductId },
      },
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
 * CLI body: seeds, prints one line per created entity, and turns any failure into exit code 1 with
 * Fineract's own messages on stderr. Printing stays to ids and names, so the authentication key and
 * the password never reach the console (Rule 1 clause 9).
 */
async function main(): Promise<void> {
  try {
    const result = await runSeed();
    for (const line of entityLines(result.entities)) {
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

