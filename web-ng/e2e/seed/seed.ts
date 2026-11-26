/** Seed of the parity fixture: the fixed test data of AAP 0.10.1 written into a freshly recreated Blitzy Fineract, so the legacy baseline and the new application run W1–W7 against the same state (Rule 2, AAP 0.9.4, AAP 0.7.3). */

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

export interface SeedEntities {
  /** `Officer, Parity` — the loan officer the loan workflows select, the name Fineract composes from the AAP 0.10.1 first and last names. */
  readonly staff: SeedEntityResult;
  /** `Parity Loan` — the product W4, W5, W6 and W7 use (AAP 0.10.1). */
  readonly loanProduct: SeedEntityResult;
  /** `Parity Fee` — the charge the loan-charges workflow applies (AAP 0.10.1). */
  readonly loanCharge: SeedEntityResult;
}

export interface SeedClientActionReasons {
  /** Value created under `ClientClosureReason`, which the close action offers. */
  readonly closure: SeedEntityResult;
  /** Value created under `ClientRejectReason`, which the reject action offers. */
  readonly rejection: SeedEntityResult;
  /** Value created under `ClientWithdrawReason`, which the withdraw action offers. */
  readonly withdrawal: SeedEntityResult;
}

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

/** What one seed run produced, written to `web-ng/e2e/.captures/seed.json` so a later tool reads the ids without querying Fineract again (Rule 1 clause 9). */
export interface SeedResult {
  /** Backend the seed wrote to, so a report can prove which one was seeded (Rule 2). */
  readonly fineractUrl: string;
  readonly tenantId: string;
  /** Verification environment, from the shared `detectBackendEnvironment` in `../check-backend`. */
  readonly environment: BackendEnvironment;
  readonly seededAt: string;
  /** The run date the seed read from Fineract, as `yyyy-mm-dd` (Rule 1 clause 2). */
  readonly runDate: string;
  readonly entities: SeedEntities;
  readonly clientActionReasons: SeedClientActionReasons;
  readonly clientActionGate: SeedClientActionGate;
}

/** Response statuses `POST` accepts: Fineract answers 200 or 201 for every resource this seed creates. */
const SUCCESS_STATUSES: readonly number[] = [200, 201];

const RESULT_ARTEFACT_URL = new URL('../.captures/seed.json', import.meta.url);

export const SEED_RESULT_ARTEFACT_PATH: string = fileURLToPath(RESULT_ARTEFACT_URL);

/** The public demo Fineract servers the harness must never talk to (Rule 2), written as escaped-dot patterns anchored on a label boundary: each one matches its host itself and any subdomain of it. */
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

/** Body of `POST /codes/name/{codeName}/codevalues`: one narration value under an existing code. */
interface CodeValueCreateBody {
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

/** Body of `POST /entityDatatableChecks`: the check that makes the gate read the table before a client action whose status it names. */
interface EntityDatatableCheckCreateBody {
  /** Entity the check applies to — `m_client`, the client entity. */
  readonly entity: string;
  /** Client status the check is registered for: `600`, CLOSE. */
  readonly status: number;
  readonly datatableName: string;
}

/** A `POST` Fineract refused. Carries the failing resource path, the status and Fineract's own `errors[].defaultUserMessage` texts, which are what the operator needs to correct the payload; it never carries the credential the refused request was sent with (Rule 1 clause 9). */
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

/** Re-throws a failed run with every known secret masked. A {@link SeedRequestError} already carries only the resource path, the status and Fineract's own validation messages, so it passes through unchanged; every other error's message has the known secrets masked before it is re-thrown. */
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

/** Collects every message Fineract itself reports for a refused call: the top-level `defaultUserMessage` and each `errors[].defaultUserMessage` (AAP 0.4.4). */
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
    // `Array.isArray` narrows to `any[]`; reading each entry as `unknown` keeps the element-by-element check explicit instead of trusting the array's element type (Rule 1 clause 4).
    for (const entry of errors as readonly unknown[]) {
      const message = isRecord(entry) ? readText(entry['defaultUserMessage']) : null;
      if (message !== null && !messages.includes(message)) {
        messages.push(message);
      }
    }
  }
  return messages;
}

/** One accepted `POST`: the status Fineract answered with and its parsed body, unread. */
interface SeedPostResult {
  /** Status Fineract answered with; one of {@link SUCCESS_STATUSES}. */
  readonly status: number;
  /** Parsed JSON body, `unknown` because it crosses the HTTP boundary. */
  readonly body: unknown;
}

/** Reads one positive integer id field of an accepted response. @param result Status and body of the accepted `POST`. @param field Id member to read: `resourceId` or `subResourceId`. @param path Resource path that produced it, named in the error message. */
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

/** Reads the `resourceId` of a created entity — the id of the resource the path names. @param result Status and body of the accepted `POST`. @param path Resource path that produced it, named in the error message. @throws When the response carries no positive integer `resourceId`. */
function readResourceId(result: SeedPostResult, path: string): number {
  return readIdentifier(result, 'resourceId', path);
}

/** Reads the `subResourceId` of a value created under another resource — the id of a new code value, where `POST /codes/name/{codeName}/codevalues` answers `{resourceId: <code id>, subResourceId: <value id>}`. */
function readSubResourceId(result: SeedPostResult, path: string): number {
  return readIdentifier(result, 'subResourceId', path);
}

function parseJsonBody(text: string, source: string): unknown {
  try {
    // `JSON.parse` answers `any`; widening it to `unknown` is the boundary each caller narrows through isRecord/readText/readResourceId, which keeps `any` out of this module (Rule 1 clause 4).
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${source} did not answer with JSON. Observed body: ${text.slice(0, 500)}`);
  }
}

/** Refuses a backend the harness must never talk to (Rule 2): a public Mifos or Fineract demo server, and any subdomain of one. */
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

/** Masks authentication material in text that is about to reach stderr (Rule 1 clause 9). */
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

/** Body of `POST /staff` for the AAP 0.10.1 row "Parity Officer, loan officer, office 1 (Head Office)". */
function staffCreateBody(): StaffCreateBody {
  return {
    officeId: SEED_STAFF.officeId,
    firstname: SEED_STAFF.firstname,
    lastname: SEED_STAFF.lastname,
    isLoanOfficer: SEED_STAFF.isLoanOfficer,
    isActive: true,
  };
}

/** Body of `POST /loanproducts` for the AAP 0.10.1 row "Parity Loan, currency USD, principal min 1,000, default 5,000, max 10,000, 12 monthly repayments, flat interest 12% per year". */
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

/** Body of `POST /charges` for the AAP 0.10.1 row "Parity Fee, flat amount 25, specified due date" (Rule 1 clause 3). */
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

/** Body of `POST /codes/name/{codeName}/codevalues` for one client-action narration value (AAP 0.10.1). */
function codeValueCreateBody(reason: ClientActionReasonSeed): CodeValueCreateBody {
  return { name: reason.valueName, isActive: true, position: 1 };
}

/** Body of `POST /datatables` for the client-action gate: the client datatable the gate's second call reads under the check. */
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

/** Body of `POST /entityDatatableChecks` for the client-action gate: the check that makes the gate read the datatable before a client action whose status it names. */
function clientActionCheckCreateBody(): EntityDatatableCheckCreateBody {
  return {
    entity: SEED_CLIENT_ACTION_GATE.apptableName,
    status: SEED_CLIENT_ACTION_GATE.checkStatus,
    datatableName: SEED_CLIENT_ACTION_GATE.datatableName,
  };
}

/** Parses a body when it is JSON and answers `undefined` when it is not, so a failed `POST` can report the status it saw instead of throwing on the way to the message that matters. */
function parseFailureBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sends one `POST` — the single request helper every step of {@link runSeed} goes through — and answers the status Fineract accepted it with and its parsed body (AAP 0.10.4). */
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

/** Creates one active narration value under its code and answers the value's own id: `POST /codes/name/{codeName}/codevalues`, keyed by the code's name so the step needs no `GET /codes` lookup and no numeric code id the tenant's migration assigns. */
async function createClientActionReason(
  context: APIRequestContext,
  reason: ClientActionReasonSeed,
): Promise<SeedEntityResult> {
  const path = '/codes/name/' + reason.codeName + '/codevalues';
  const created = await post(context, path, codeValueCreateBody(reason));
  return { name: reason.valueName, id: readSubResourceId(created, path) };
}

/** Creates one entity and answers the id Fineract assigned: {@link post} followed by {@link readResourceId}, for the resources that answer their own `resourceId` — the staff member, both products and the charge. @param context The request context {@link post} sends through. @param path Resource path of the `POST`, below the API path. @param body Request body that endpoint expects. */
async function createEntity(context: APIRequestContext, path: string, body: unknown): Promise<number> {
  return readResourceId(await post(context, path, body), path);
}

/** Registers the client datatable and its entity-datatable check — the fixture the datatable gate needs before it can read anything: with no check registered, `GET /entityDatatableChecks?limit=-1` answers no rows and the gate has nothing to read (AAP 0.10.4). */
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

/** Removes the artefact an earlier run wrote, so no consumer can read a previous run's ids once this run has started. {@link runSeed} calls it before anything else — before the backend is vetted and before the first write this run makes (AAP 0.14.2). */
export async function discardResultArtefact(path: string = SEED_RESULT_ARTEFACT_PATH): Promise<void> {
  await rm(path, { force: true });
}

/** Writes the run's result to `web-ng/e2e/.captures/seed.json`, the one artefact this script produces (Rule 1 clause 9). */
async function writeResultArtefact(result: SeedResult): Promise<void> {
  const path = SEED_RESULT_ARTEFACT_PATH;
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    // `force` treats an already-absent temporary file as success, and a second failure here is swallowed so the error the caller sees is the write or rename that actually failed.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function entityLines(result: SeedResult): string[] {
  return [
    `staff: ${result.entities.staff.name} id=${result.entities.staff.id}`,
    `loan product: ${result.entities.loanProduct.name} id=${result.entities.loanProduct.id}`,
    `loan charge: ${result.entities.loanCharge.name} id=${result.entities.loanCharge.id}`,
    `closure reason: ${result.clientActionReasons.closure.name} id=${result.clientActionReasons.closure.id}`,
    `rejection reason: ${result.clientActionReasons.rejection.name} id=${result.clientActionReasons.rejection.id}`,
    `withdrawal reason: ${result.clientActionReasons.withdrawal.name} id=${result.clientActionReasons.withdrawal.id}`,
    `client action gate: ${result.clientActionGate.datatableName} on ${result.clientActionGate.apptableName} status=${result.clientActionGate.checkStatus} check id=${result.clientActionGate.checkId}`,
  ];
}

function describeFailure(error: unknown): string[] {
  if (error instanceof SeedRequestError) {
    return [error.message, ...error.validationMessages.map((message) => `  - ${message}`)];
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return [String(error)];
}

/** Seeds the fixed parity data and reports what it created — the module's one entry point, called by the CLI below and by nothing else (AAP 0.10.1, AAP 0.9.1, Rule 1 clause 2, Rule 1 clause 9). */
export async function runSeed(): Promise<SeedResult> {
  await discardResultArtefact();
  assertPermittedBackend(FINERACT_URL);
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

/** What `--help` prints: the writes this command performs, the variables it reads — named, never valued (Rule 1 clause 9) — and the two ways it is invoked. */
const SEED_USAGE: CliUsage = {
  name: 'seed',
  summary: 'Creates the AAP 0.10.1 parity fixtures in a freshly recreated Blitzy Fineract and records their ids in e2e/.captures/seed.json.',
  effects: [
    'writes three records, in this order: staff (POST /staff), loan product (POST /loanproducts), loan charge (POST /charges)',
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

/** CLI body: seeds, prints one line per created entity, and turns any failure into exit code 1 with Fineract's own messages on stderr (Rule 1 clause 9). */
async function main(): Promise<void> {
  // Usage is answered before runSeed(), so `--help` inspects the three writes without performing one.
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

// Guarded entry: the script runs only when executed directly. Importing this module — which the Playwright loader does while collecting the suite — must stay inert, so `npx playwright test --list` exits 0 with no seed request attempted while the suite is collected (AAP 0.10.3).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}

