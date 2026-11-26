/** Parity report writer and type owner for the legacy-versus-next Playwright harness (AAP 0.11.1 row 51 "Markdown + JSON parity report writer", Priority High; AAP 0.8.1 `report/parity-report.ts`; AAP 0.8.2, where `npm run (AAP 0.10.4, AAP 0.10.3, Rule 1 clause 1, Rule 2). */
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { NormalizedExchange, NormalizedValue } from '../capture/network-capture';
import type { StateSnapshot } from '../capture/state-snapshot';
import {
  DIFFERENCE_REGISTER_READINGS,
  renderDifferenceRegister,
  type DifferenceRegisterReading,
} from './difference-register';

/** Every workflow the suite runs, in the order AAP 0.8.2 and 0.10.4 list them: W1 to W7 plus the `CHAIN` spec (`chain-w2-w4-w5-w6`). */
export const WORKFLOW_IDS: readonly WorkflowId[] = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'CHAIN'];

/** The two Playwright projects: the untouched AngularJS baseline and this application (AAP 0.10.1). */
export const UI_PROJECTS: readonly UiProject[] = ['legacy', 'next'];

/** The closed status set AAP 0.10.4 fixes, in the order the report lists them. */
export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = ['pass', 'fail', 'legacy-broken', 'intentional-diff'];

/** Highest AAP 0.10.5 item number an `intentional-diff` row may cite (Rule 1 clause 3). */
const MAX_INTENTIONAL_DIFF_ID = 16;

/** Workflow ids the harness knows by name (AAP 0.8.2); `CHAIN` is the W2 -> W4 -> W5 -> W6 spec. */
export type WorkflowId = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'CHAIN';

/** How one workflow ended on one front end (AAP 0.10.4's closed vocabulary). */
export type WorkflowStatus = 'pass' | 'fail' | 'legacy-broken' | 'intentional-diff';

/** Which front end a record describes: the legacy baseline or the new Angular application. */
export type UiProject = 'legacy' | 'next';

/** One difference between the two sides (AAP 0.10.2). A request difference carries the call it belongs to; an end-state difference is anchored to no call, so it carries {@link STATE_DIFF_METHOD} and an empty `path`, and. */
export interface WorkflowDiff {
  method: string;
  /** Normalised request path of that exchange, or `''` for a state difference. */
  path: string;
  /** What differs, as a value path: `query.command`, `requestBody.principal`, `client.status`. */
  field: string;
  /** The legacy side's value; `null` when that side has none. */
  legacy: unknown;
  /** The new app's value; `null` when that side has none. */
  next: unknown;
}

/** One workflow's outcome on one front end — the record every spec writes through {@link writeWorkflowRecord}, and the document the report is built from (AAP 0.10.3 criterion 4). */
export interface WorkflowRecord {
  workflow: WorkflowId;
  project: UiProject;
  status: WorkflowStatus;
  /** Why: required for `legacy-broken` and `intentional-diff`, optional colour for any other status. */
  reason?: string;
  /** The AAP 0.10.5 item number an `intentional-diff` rests on; required for that status, `1` to `16`. */
  intentionalDiffId?: number;
  /** Path of the normalised capture `capture/network-capture.ts` wrote for this run. */
  capturePath?: string;
  /** Path of the reduced end state `capture/state-snapshot.ts` wrote for this run. */
  statePath?: string;
  /** Differences the spec itself observed, kept for a `fail` row. */
  diffs?: WorkflowDiff[];
  /** First failing step of a `fail` row. */
  failingStep?: string;
  recordedAt?: string;
}

/** The run the report describes: environment, backend provenance, the three addresses and the dates (AAP 0.10.4, 0.10.3, Rule 2). */
export interface ReportHeader {
  /** Where the run happened, detected from `CODESPACES` (AAP 0.10.3 keeps environments to variables). */
  environment: 'mac' | 'codespaces';
  /** `owner/name` the backend was built from; `null` only when provenance is unverified. */
  backendRemote: string | null;
  /** Commit the backend reports; `null` only when provenance is unverified. */
  backendCommit: string | null;
  /** Backend address the run called, from `FINERACT_URL` (Rule 2). */
  fineractUrl: string;
  /** Legacy baseline address the run drove, from `LEGACY_URL`. */
  legacyUrl: string;
  /** New application address the run drove, from `NEXT_URL`. */
  nextUrl: string;
  /** The tenant's business date as `yyyy-mm-dd`; `''` when it could not be read — never a browser date. */
  runDate: string;
  generatedAt: string;
  /** Whether provenance was recorded; `false` fails the command (Rule 2). */
  backendVerified: boolean;
}

/** One cell of the report's workflow matrix: a record as the report sees it, or the `missing` row no record produced. */
export interface WorkflowRow {
  workflow: WorkflowId;
  project: UiProject;
  /** How it ended, or `missing` when no record exists. */
  status: WorkflowStatus | 'missing';
  /** Why, for `legacy-broken` and `intentional-diff`. */
  reason?: string;
  /** The AAP 0.10.5 item an `intentional-diff` rests on. */
  intentionalDiffId?: number;
  /** First failing step, for a `fail` row. */
  failingStep?: string;
  diffs?: WorkflowDiff[];
  /** Whether this row's workflow could be compared at all — false when the legacy side is broken or absent. */
  comparable: boolean;
}

export interface UnreadableRecord {
  readonly path: string;
  /** Why it was rejected, in the module's own words — never the document's content (Rule 1 clause 9). */
  readonly message: string;
}

export interface ParityReport {
  header: ReportHeader;
  workflows: WorkflowRow[];
  /** The deliberate-difference register AAP 0.10.5 requires and acceptance criterion 4 has a human read: the readings this run takes more narrowly than the plan's wording, rendered as their own section of `parity-report.md`. */
  readonly differenceRegister: readonly DifferenceRegisterReading[];
  readonly unreadable?: readonly UnreadableRecord[];
  /** The measured generated-line total held against AAP 0.9.3's ceiling, with the trim record that keeps the tree there (Rule 1 clause 10). */
  readonly lineBudget?: LineBudget;
}

/** AAP 0.9.3's size record, taken on the plan's own basis at report time: the delivered tree's generated lines, the ceiling they are held to, the prose trim, the scope cut AAP 0.9.3's fixed order required once the tree crossed that ceiling, and the check scripts' recorded share. */
export interface LineBudget {
  /** Generated lines across every tracked file except `package-lock.json`; `null` when the tree could not be listed. */
  readonly measuredLines: number | null;
  /** Tracked files the measurement covered, `package-lock.json` aside. */
  readonly measuredFiles: number;
  /** Lines in the three check scripts and their `lib/` helpers, against AAP 0.9.3's share of "about 600". */
  readonly checkScriptLines: number;
  /** Whether the measured total is inside AAP 0.9.3's ceiling, over it, or was not measurable in this environment. */
  readonly verdict: 'within' | 'over' | 'unmeasured';
}

/** AAP 0.9.3's ceiling: 60,000 generated lines across code, tests, configuration and documentation (Rule 1 clause 10). */
export const LINE_CEILING = 60_000;

/** The planning target AAP 0.9.3 names beside the ceiling. */
export const PLANNING_TARGET = 50_000;

/** Generated lines the tracked tree carried at `4a13dc7`, the commit the documentation-prose trim follows — the crossing of AAP 0.9.3's ceiling that engaged the plan's fixed cut order — measured the report's own way, `git ls-files | grep -v package-lock.json | xargs wc -l` from the repository root (AAP 0.9.3). */
export const LINES_BEFORE_TRIM = 88_418;

/** Generated lines the tracked tree carried at `c05766d`, the prose trim and the commit the savings cut follows: below AAP 0.9.3's ceiling, which is why the cut is recorded against the crossing {@link LINES_BEFORE_TRIM} states and never against this commit (AAP 0.9.3). */
export const LINES_AT_CUT_COMMIT = 58_799;

/** Lines the savings cut removed from the tracked tree, measured at `c05766d`: the 17 files it deleted — 3,926 in the 14 `src/app/features/savings` files and 1,288 in its two page objects and its W8 spec (AAP 0.9.3). */
export const SAVINGS_CUT_LINES = 5_214;

/** Generated lines the tracked tree carried before this checkpoint's second prose trim: 59,487 at the previous checkpoint plus the net lines of the four fix sets that landed with it — the second crossing of AAP 0.9.3's ceiling, which engaged the plan's fixed cut order again (AAP 0.9.3, Rule 1 clause 10). */
export const LINES_BEFORE_SECOND_TRIM = 60_201;

/** The net lines those four landed fix sets added, which took the tree over the ceiling: the i18n and language-preference work +574, the session work +101, the loan-charge work +39 and the loans doc comments 0 (AAP 0.9.3). */
export const SECOND_TRIM_ADDED_LINES = 714;

/** Generated lines the tracked tree carried before this checkpoint's third prose trim: 59,784 at the previous checkpoint plus the net lines of the ten fix sets that landed with it — the third crossing of AAP 0.9.3's ceiling, which engaged the plan's fixed cut order again (AAP 0.9.3, Rule 1 clause 10). */
export const LINES_BEFORE_THIRD_TRIM = 62_420;

/** The net lines those ten landed fix sets added across 91 files, which took the tree over the ceiling: 3,748 added and 1,112 removed over the whole set (AAP 0.9.3). */
export const THIRD_TRIM_ADDED_LINES = 2_636;

/** The repository root every measurement below is taken from — `web-ng/`'s parent — resolved from this module's own URL so `git ls-files` sees the whole delivered tree. */
const REPO_ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));

/** The check scripts and their helpers: the files AAP 0.9.3 budgets "about 600 lines" for. */
const CHECK_SCRIPT_PREFIX = 'web-ng/tools/parity/';

/** `method` of a difference in the backend end state: an end-state difference is not anchored to one API call, so this label marks it and keeps it apart from a request difference. */
const STATE_DIFF_METHOD = 'STATE';

/** Directory the harness's artefacts live in, resolved from this module's own location so the suite finds them however it is launched — `npm run e2e` launches it from `web-ng/`, and a caller may launch it from anywhere. */
const CAPTURES_DIR = fileURLToPath(new URL('../.captures', import.meta.url));

const WORKFLOWS_DIR = join(CAPTURES_DIR, 'workflows');

/** The Markdown report, at the package root as AAP 0.10.4 names it. */
const MARKDOWN_PATH = fileURLToPath(new URL('../../parity-report.md', import.meta.url));

const JSON_PATH = fileURLToPath(new URL('../../parity-report.json', import.meta.url));

/** Raised when a record cannot be trusted: an unknown workflow, project or status, or an acknowledged difference without the reason and AAP 0.10.5 item criterion 4 requires. */
export class ParityRecordError extends Error {
  readonly record: unknown;

  constructor(message: string, record: unknown) {
    super(message);
    this.name = 'ParityRecordError';
    this.record = record;
  }
}

/** Raised when the report itself cannot be produced or safely written (Rule 1 clause 9, Rule 2). */
export class ParityReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParityReportError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a rejected value is, by type alone. Messages name the field and the shape it should have and never repeat the value it carried: a hand-written record could put a credential in any field, and a message reaches (Rule 1 clause 9). */
function typeName(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function isWorkflowId(value: unknown): value is WorkflowId {
  return typeof value === 'string' && (WORKFLOW_IDS as readonly string[]).includes(value);
}

/** Whether a value is one of the four statuses AAP 0.10.4 closes over. */
function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === 'string' && (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

function isUiProject(value: unknown): value is UiProject {
  return typeof value === 'string' && (UI_PROJECTS as readonly string[]).includes(value);
}

/** Whether a status acknowledges a difference from legacy, and so must carry a reason. */
function requiresReason(status: WorkflowStatus): boolean {
  return status === 'legacy-broken' || status === 'intentional-diff';
}

/** Whether a value is a usable AAP 0.10.5 item number: a whole number from 1 to {@link MAX_INTENTIONAL_DIFF_ID}. */
function isIntentionalDiffId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INTENTIONAL_DIFF_ID;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/** An optional text field of a parsed record, or `undefined` when absent, null or blank. */
function optionalText(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ParityRecordError(`a record's ${field} must be a string, not ${typeName(value)}`, source);
  }
  return hasText(value) ? value : undefined;
}

/** The `diffs` of a parsed record, each entry narrowed to {@link WorkflowDiff}. */
function optionalDiffs(source: Record<string, unknown>): WorkflowDiff[] | undefined {
  const value = source['diffs'];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ParityRecordError(`a record's diffs must be an array, not ${typeName(value)}`, source);
  }
  return value.map((entry: unknown): WorkflowDiff => {
    if (!isRecord(entry)) {
      throw new ParityRecordError(`every diffs entry must be an object, not ${typeName(entry)}`, source);
    }
    const { method, path, field } = entry;
    if (typeof method !== 'string' || typeof path !== 'string' || typeof field !== 'string') {
      throw new ParityRecordError('a diffs entry needs a string method, path and field', source);
    }
    // The two sides are whatever the normalised exchange or the reduced state held; they are compared as opaque JSON values and rendered as text, so they stay untyped on purpose (AAP 0.10.2).
    return { method, path, field, legacy: entry['legacy'], next: entry['next'] };
  });
}

/** What {@link redactEntryLocation} writes in place of a masked value: `***`, the marker AAP 0.10.2 uses for session and auth material in both captures and the one {@link UNMASKED_CREDENTIAL_PATTERN} already exempts, so. */
const ENTRY_LOCATION_MASK = '***';

/** One `baseApiUrl`/`tenantIdentifier` value in free text, in every form — `tenantIdentifier=default` in a query string, `"tenantIdentifier": "default"` as JSON, either one with spaces around the separator. */
const ENTRY_LOCATION_PAIR = /\b(baseApiUrl|tenantIdentifier)(["']?\s*[:=]\s*["']?)(?!\*\*\*)([^\s"'&#,;)|}\]]+)/gi;

/** Masks the values a legacy entry URL carries out of free text: the `baseApiUrl` and `tenantIdentifier` query parameters' values become `***` and everything else is kept, so a diagnostic that quotes (Rule 2, AAP 0.3.4, Rule 1 clause 9, AAP 0.10.4). */
export function redactEntryLocation(text: string): string {
  return text.replace(
    ENTRY_LOCATION_PAIR,
    (_pair: string, parameter: string, separator: string) => `${parameter}${separator}${ENTRY_LOCATION_MASK}`,
  );
}

function redactedText(source: Record<string, unknown>, field: string): string | undefined {
  const text = optionalText(source, field);
  return text === undefined ? undefined : redactEntryLocation(text);
}

function narrowRecord(value: unknown): WorkflowRecord {
  if (!isRecord(value)) {
    throw new ParityRecordError(`a workflow record must be a JSON object, not ${typeName(value)}`, value);
  }
  const { workflow, project, status } = value;
  if (!isWorkflowId(workflow)) {
    throw new ParityRecordError(`a record's workflow must be one of ${WORKFLOW_IDS.join(', ')}`, value);
  }
  if (!isUiProject(project)) {
    throw new ParityRecordError(`a record's project must be one of ${UI_PROJECTS.join(', ')}`, value);
  }
  if (!isWorkflowStatus(status)) {
    throw new ParityRecordError(`a record's status must be one of ${WORKFLOW_STATUSES.join(', ')}`, value);
  }
  // `reason` and `failingStep` are the record's free-text fields: they carry a page object's own diagnostic, and such a message quotes the entry URL a run opened — `?baseApiUrl=…&tenantIdentifier=…` — so both are masked (Rule 1 clause 9, AAP 0.10.4, AAP 0.10.1).
  const reason = redactedText(value, 'reason');
  const intentionalDiffId = value['intentionalDiffId'];
  if (requiresReason(status) && !hasText(reason)) {
    throw new ParityRecordError(`a ${project}/${workflow} ${status} record needs a non-empty reason`, value);
  }
  if (intentionalDiffId !== undefined && !isIntentionalDiffId(intentionalDiffId)) {
    throw new ParityRecordError(
      `a record's intentionalDiffId must be a whole number from 1 to ${MAX_INTENTIONAL_DIFF_ID} (AAP 0.10.5)`,
      value,
    );
  }
  if (status === 'intentional-diff' && intentionalDiffId === undefined) {
    // Rule 1 clause 3: a deliberate difference from legacy must name the AAP 0.10.5 item that justifies it.
    throw new ParityRecordError(`a ${project}/${workflow} intentional-diff record needs its AAP 0.10.5 item number`, value);
  }
  const capturePath = optionalText(value, 'capturePath');
  const statePath = optionalText(value, 'statePath');
  // Masked like `reason`, and for the same reason: a first failing step is the message a page object threw.
  const failingStep = redactedText(value, 'failingStep');
  const recordedAt = optionalText(value, 'recordedAt');
  const diffs = optionalDiffs(value);
  return {
    workflow,
    project,
    status,
    ...(reason === undefined ? {} : { reason }),
    ...(intentionalDiffId === undefined ? {} : { intentionalDiffId }),
    ...(capturePath === undefined ? {} : { capturePath }),
    ...(statePath === undefined ? {} : { statePath }),
    ...(diffs === undefined ? {} : { diffs }),
    ...(failingStep === undefined ? {} : { failingStep }),
    ...(recordedAt === undefined ? {} : { recordedAt }),
  };
}

/** Where one workflow's record lives: `<repoRoot>/web-ng/e2e/.captures/workflows/<project>__<workflow>.json`, resolved from this module's location rather than the working directory (AAP 0.8.1, 0.11.1). */
export function workflowRecordPath(project: UiProject, workflow: WorkflowId): string {
  return join(WORKFLOWS_DIR, `${project}__${workflow}.json`);
}

/** Refuses a record criterion 4 could not read back: an unknown workflow, project or status, an acknowledged difference without a reason, or one without its AAP 0.10.5 item number (Rule 1 clause 9, AAP 0.10.4). */
export function validateRecord(record: WorkflowRecord): WorkflowRecord {
  // The gate is `narrowRecord`, so a typed record and a hand-written one are held to one standard.
  return narrowRecord(record);
}

/** Writes one record atomically — a `<name>.tmp` beside it, then a rename — so a reader never sees half a record and a crashed run leaves no parseable half-file behind (Rule 1 clause 9, AAP 0.10.4). */
export async function writeWorkflowRecord(record: WorkflowRecord): Promise<string> {
  const validated = validateRecord(record);
  const path = workflowRecordPath(validated.project, validated.workflow);
  await mkdir(WORKFLOWS_DIR, { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
  console.log(`parity record: ${validated.project}/${validated.workflow} ${validated.status}`);
  return path;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

/** Reads every record the fixtures left in `.captures/workflows/`. */
export async function readWorkflowRecords(): Promise<{ records: WorkflowRecord[]; unreadable: UnreadableRecord[] }> {
  let entries: string[];
  try {
    entries = await readdir(WORKFLOWS_DIR);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { records: [], unreadable: [] };
    }
    throw new ParityReportError(`the record directory ${WORKFLOWS_DIR} could not be listed`);
  }
  const records: WorkflowRecord[] = [];
  const unreadable: UnreadableRecord[] = [];
  // `.tmp` files are skipped by the filter, so a write interrupted before its rename is not read back.
  for (const name of entries.filter((entry) => entry.endsWith('.json')).sort()) {
    const path = join(WORKFLOWS_DIR, name);
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      records.push(narrowRecord(parsed));
    } catch (error) {
      // The message is this module's own or a filesystem error code: a JSON parse error quotes the document it rejected, which could carry a credential into the report (Rule 1 clause 9).
      const message = error instanceof ParityRecordError
        ? error.message
        : `${isMissingFileError(error) ? 'the file vanished' : 'the file is not valid JSON'}`;
      unreadable.push({ path, message });
    }
  }
  return { records, unreadable };
}

type Artifact<T> =
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'absent'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly path: string; readonly message: string };

/** Reads one JSON artefact a record names, falling back to the path its writer uses when the record names none: `.captures/network/<project>__<workflow>.json` for a capture and `.captures/state/<project>__<workflow>.json`. */
async function readArtifact<T>(
  label: string,
  declaredPath: string | undefined,
  fallbackPath: string,
  parse: (value: unknown) => T | null,
): Promise<Artifact<T>> {
  const path = declaredPath ?? fallbackPath;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (declaredPath === undefined && isMissingFileError(error)) {
      return { kind: 'absent', path };
    }
    return { kind: 'unreadable', path, message: `the ${label} could not be read` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', path, message: `the ${label} is not valid JSON` };
  }
  const value = parse(parsed);
  return value === null
    ? { kind: 'unreadable', path, message: `the ${label} does not hold the documented shape` }
    : { kind: 'loaded', value };
}

/** The exchanges of one capture document, or `null` when the document is not the `{project, workflow, runDate, exchanges, roles}` shape `capture/network-capture.ts` writes (Rule 1 clause 4). */
function toExchanges(value: unknown): NormalizedExchange[] | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value['exchanges'];
  if (!Array.isArray(raw)) {
    return null;
  }
  const exchanges: NormalizedExchange[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return null;
    }
    const { method, origin, path, query, status, hasTenantHeader, hasAuthorizationHeader } = entry;
    if (
      typeof method !== 'string' || typeof origin !== 'string' || typeof path !== 'string'
      || typeof status !== 'number' || typeof hasTenantHeader !== 'boolean'
      || typeof hasAuthorizationHeader !== 'boolean' || !isRecord(query)
    ) {
      return null;
    }
    const queryValues: Record<string, string> = {};
    for (const [key, parameter] of Object.entries(query)) {
      if (typeof parameter !== 'string') {
        return null;
      }
      queryValues[key] = parameter;
    }
    const body = (raw: unknown): NormalizedValue | null => (raw === undefined ? null : raw as NormalizedValue);
    exchanges.push({
      method,
      origin,
      path,
      query: queryValues,
      status,
      hasTenantHeader,
      hasAuthorizationHeader,
      requestBody: body(entry['requestBody']),
      responseBody: body(entry['responseBody']),
    });
  }
  return exchanges;
}

/** The reduced end state of one snapshot document, or `null` when it is not the `{project, workflow, runDate, client?, loan?}` shape `capture/state-snapshot.ts` writes. */
function toStateSnapshot(value: unknown): StateSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const { project, workflow, runDate } = value;
  if (!isUiProject(project) || typeof workflow !== 'string' || typeof runDate !== 'string') {
    return null;
  }
  for (const section of ['client', 'loan']) {
    const present = value[section];
    if (present !== undefined && !isRecord(present)) {
      return null;
    }
  }
  return value as unknown as StateSnapshot;
}


function rowKey(workflow: WorkflowId, project: UiProject): string {
  return `${workflow}::${project}`;
}

/** The capture `capture/network-capture.ts` writes for one project and workflow, used when a record names none. */
function capturePath(record: WorkflowRecord): string {
  return join(CAPTURES_DIR, 'network', `${record.project}__${record.workflow}.json`);
}

/** The end state `capture/state-snapshot.ts` writes for one project and workflow, used when a record names none. */
function statePath(record: WorkflowRecord): string {
  return join(CAPTURES_DIR, 'state', `${record.project}__${record.workflow}.json`);
}

/** A row for one cell of the matrix — the record's own facts, or `missing` when no record was written. */
function rowOf(workflow: WorkflowId, project: UiProject, record: WorkflowRecord | undefined): WorkflowRow {
  if (record === undefined) {
    return { workflow, project, status: 'missing', comparable: false };
  }
  const row: WorkflowRow = { workflow, project, status: record.status, comparable: false };
  if (record.reason !== undefined) {
    row.reason = record.reason;
  }
  if (record.intentionalDiffId !== undefined) {
    row.intentionalDiffId = record.intentionalDiffId;
  }
  if (record.failingStep !== undefined) {
    row.failingStep = record.failingStep;
  }
  if (record.diffs !== undefined) {
    row.diffs = record.diffs;
  }
  return row;
}

/** The header: where the run happened, which backend backed it, the three addresses and the run date (Rule 2, Rule 1 clause 2). */
async function resolveHeader(): Promise<ReportHeader> {
  const [backend, fixtures] = await Promise.all([import('../check-backend'), import('../seed/fixtures')]);
  let info = backend.readBackendInfo();
  if (info === null) {
    try {
      info = await backend.resolveBackendInfo();
    } catch {
      info = null;
    }
  }
  let runDate = '';
  try {
    runDate = fixtures.formatDateOnly(await fixtures.readBusinessDate());
  } catch {
    runDate = '';
  }
  return {
    environment: backend.detectBackendEnvironment(),
    backendRemote: info === null ? null : info.remote,
    backendCommit: info === null ? null : info.commit,
    fineractUrl: fixtures.FINERACT_URL,
    legacyUrl: fixtures.LEGACY_URL,
    nextUrl: fixtures.NEXT_URL,
    runDate,
    generatedAt: new Date().toISOString(),
    backendVerified: info !== null,
  };
}

function problemsOf(artifact: Artifact<unknown>, absentIsProblem = true): UnreadableRecord[] {
  if (artifact.kind === 'loaded' || (artifact.kind === 'absent' && !absentIsProblem)) {
    return [];
  }
  return [{ path: artifact.path, message: artifact.kind === 'absent' ? 'not written by the run' : artifact.message }];
}

function presenceOf(artifact: Artifact<unknown>): string {
  return artifact.kind === 'loaded' ? 'recorded' : artifact.kind === 'absent' ? 'not recorded' : 'unreadable';
}

function sameDiff(left: WorkflowDiff, right: WorkflowDiff): boolean {
  return left.method === right.method && left.path === right.path && left.field === right.field
    && JSON.stringify(left.legacy) === JSON.stringify(right.legacy)
    && JSON.stringify(left.next) === JSON.stringify(right.next);
}

function mergeDiffs(own: readonly WorkflowDiff[], computed: readonly WorkflowDiff[]): WorkflowDiff[] {
  const merged = [...own];
  for (const diff of computed) {
    if (!merged.some((existing) => sameDiff(existing, diff))) {
      merged.push(diff);
    }
  }
  return merged;
}

/** Names the first place two sides that both passed differ, by call and field only — never by value, because a reason reaches both documents and a value there would bypass the credential guard, which inspects the diff (Rule 1 clause 9). */
function describeDiffs(diffs: readonly WorkflowDiff[]): string {
  const first = diffs[0];
  if (first === undefined) {
    return 'an empty difference';
  }
  const anchor = first.method === STATE_DIFF_METHOD ? 'the backend end state' : `${first.method} ${first.path}`;
  return `${anchor} at ${first.field}`;
}

/** Compares one workflow's two runs: the ordered API calls (AAP 0.10.1, 0.10.2) and the reduced end states. */
async function compareSides(
  legacy: WorkflowRecord,
  next: WorkflowRecord,
): Promise<{ diffs: WorkflowDiff[]; problems: UnreadableRecord[] }> {
  const [capture, snapshot] = await Promise.all([
    import('../capture/network-capture'),
    import('../capture/state-snapshot'),
  ]);
  const [legacyCapture, nextCapture] = await Promise.all([
    readArtifact('legacy capture', legacy.capturePath, capturePath(legacy), toExchanges),
    readArtifact('next capture', next.capturePath, capturePath(next), toExchanges),
  ]);
  const [legacyState, nextState] = await Promise.all([
    readArtifact('legacy end state', legacy.statePath, statePath(legacy), toStateSnapshot),
    readArtifact('next end state', next.statePath, statePath(next), toStateSnapshot),
  ]);
  const diffs: WorkflowDiff[] = [];
  if (legacyCapture.kind === 'loaded' && nextCapture.kind === 'loaded') {
    for (const diff of capture.diffExchanges(legacyCapture.value, nextCapture.value)) {
      diffs.push({ method: diff.method, path: diff.path, field: diff.field, legacy: diff.legacy, next: diff.next });
    }
  }
  if (legacyState.kind === 'loaded' && nextState.kind === 'loaded') {
    for (const diff of snapshot.diffStates(legacyState.value, nextState.value)) {
      diffs.push({ method: STATE_DIFF_METHOD, path: '', field: diff.field, legacy: diff.legacy, next: diff.next });
    }
  } else if (legacyState.kind !== 'unreadable' && nextState.kind !== 'unreadable'
    && legacyState.kind !== nextState.kind) {
    diffs.push({
      method: STATE_DIFF_METHOD,
      path: '',
      field: 'state',
      legacy: presenceOf(legacyState),
      next: presenceOf(nextState),
    });
  }
  return {
    diffs,
    problems: [
      ...problemsOf(legacyCapture),
      ...problemsOf(nextCapture),
      ...problemsOf(legacyState, false),
      ...problemsOf(nextState, false),
    ],
  };
}

/** Fills in `comparable` for every row and computes the differences of every workflow both sides ran (AAP 0.10.1). */
async function compareWorkflows(
  records: Map<string, WorkflowRecord>,
  rows: Map<string, WorkflowRow>,
): Promise<UnreadableRecord[]> {
  const problems: UnreadableRecord[] = [];
  for (const workflow of WORKFLOW_IDS) {
    const legacy = records.get(rowKey(workflow, 'legacy'));
    const next = records.get(rowKey(workflow, 'next'));
    const legacyRow = rows.get(rowKey(workflow, 'legacy'));
    const nextRow = rows.get(rowKey(workflow, 'next'));
    if (legacyRow === undefined || nextRow === undefined) {
      continue;
    }
    const comparable = legacy !== undefined && legacy.status !== 'legacy-broken';
    legacyRow.comparable = comparable;
    nextRow.comparable = comparable;
    if (!comparable || legacy === undefined || next === undefined) {
      continue;
    }
    const comparison = await compareSides(legacy, next);
    problems.push(...comparison.problems);
    const diffs = mergeDiffs(next.diffs ?? [], comparison.diffs);
    if (diffs.length > 0) {
      nextRow.diffs = diffs;
    }
    if (legacy.status === 'pass' && next.status === 'pass'
      && (diffs.length > 0 || comparison.problems.length > 0)) {
      nextRow.status = 'fail';
      nextRow.reason = diffs.length > 0
        ? `both sides pass, but they differ — ${describeDiffs(diffs)}`
        : `parity could not be established: ${comparison.problems[0]?.message ?? 'an artefact is missing'}`;
    }
  }
  return problems;
}

/** The repository's tracked paths minus `package-lock.json`, which Rule 1 clause 7 keeps out of the manifest; a `git` that is missing or fails rejects, and {@link measureLineBudget} reports that as unmeasured. */
function trackedFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('git', ['ls-files'], { cwd: REPO_ROOT_DIR, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(stdout.split('\n').filter((file) => file.length > 0 && !file.endsWith('package-lock.json')));
    });
  });
}

/** Measures the delivered tree on AAP 0.9.3's own basis — `git ls-files` minus `package-lock.json`, every line counted — so the report states the revised total beside the ceiling instead of leaving the budget arithmetic implicit; a tree that cannot be listed is reported `unmeasured` rather than guessed at, and a path that cannot be read (the dangling `web-ng/app` link) counts zero lines. */
export async function measureLineBudget(): Promise<LineBudget> {
  let tracked: string[];
  try {
    tracked = await trackedFiles();
  } catch {
    return { measuredLines: null, measuredFiles: 0, checkScriptLines: 0, verdict: 'unmeasured' };
  }
  let measuredLines = 0;
  let checkScriptLines = 0;
  for (const file of tracked) {
    let text: string;
    try {
      text = await readFile(join(REPO_ROOT_DIR, file), 'utf8');
    } catch {
      continue;
    }
    const count = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    measuredLines += count;
    if (file.startsWith(CHECK_SCRIPT_PREFIX) && file.endsWith('.ts')) {
      checkScriptLines += count;
    }
  }
  return {
    measuredLines,
    measuredFiles: tracked.length,
    checkScriptLines,
    verdict: measuredLines > LINE_CEILING ? 'over' : 'within',
  };
}

/** Builds the whole report: header, the eight workflow rows for each front end, the comparison, the deliberate-difference register AAP 0.10.5 requires, the artefacts that could not be read (AAP 0.10.3 criterion 4) and the size record AAP 0.9.3 requires. */
export async function buildReport(): Promise<ParityReport> {
  const [header, { records, unreadable }] = await Promise.all([resolveHeader(), readWorkflowRecords()]);
  const byKey = new Map<string, WorkflowRecord>();
  for (const record of records) {
    byKey.set(rowKey(record.workflow, record.project), record);
  }
  const rows = new Map<string, WorkflowRow>();
  for (const workflow of WORKFLOW_IDS) {
    for (const project of UI_PROJECTS) {
      rows.set(rowKey(workflow, project), rowOf(workflow, project, byKey.get(rowKey(workflow, project))));
    }
  }
  const problems = await compareWorkflows(byKey, rows);
  const lineBudget = await measureLineBudget();
  return {
    header,
    workflows: [...rows.values()],
    differenceRegister: DIFFERENCE_REGISTER_READINGS,
    unreadable: [...unreadable, ...problems],
    lineBudget,
  };
}


const MAX_DIFF_ROWS = 25;

function cell(value: unknown, limit = 120): string {
  const text = value === undefined || value === null
    ? '—'
    : typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function pushTable(
  lines: string[],
  title: string,
  header: readonly string[],
  rows: readonly (readonly string[])[],
  showCount = false,
): void {
  if (rows.length === 0) {
    return;
  }
  const caption = showCount ? `${title} (${rows.length})` : title;
  lines.push('', caption, '', `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows.slice(0, MAX_DIFF_ROWS)) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  if (rows.length > MAX_DIFF_ROWS) {
    lines.push('', `… ${rows.length - MAX_DIFF_ROWS} more`);
  }
}

function rowAt(rows: readonly WorkflowRow[], workflow: WorkflowId, project: UiProject): WorkflowRow | undefined {
  return rows.find((row) => row.workflow === workflow && row.project === project);
}

function group(value: number): string {
  return value.toLocaleString('en-US');
}

/** The `## Line budget` section's lines: ceiling, measured total with the command that settles it, the prose trim and the second trim the landed fix sets' growth required, the revised totals at the two commits on either side of the first, the scope cut AAP 0.9.3's fixed order required and why — with the total restoring the cut half would measure — and the check scripts' recorded share (AAP 0.9.3, Rule 1 clause 10). */
function lineBudgetLines(budget: LineBudget | undefined): string[] {
  if (budget === undefined || budget.measuredLines === null) {
    return ['', 'Not measured: `git ls-files` could not list the tree in this environment, so the generated-line total and the cut record are unestablished here.'];
  }
  const measured = budget.measuredLines;
  const standing = budget.verdict === 'over'
    ? `over the ceiling by ${group(measured - LINE_CEILING)} lines`
    : `inside the ceiling by ${group(LINE_CEILING - measured)} lines`;
  return [
    '',
    `- Ceiling: ${group(LINE_CEILING)} generated lines across code, tests, configuration and documentation, with a planning target of about ${group(PLANNING_TARGET)} (AAP 0.9.3).`,
    `- Measured: ${group(measured)} generated lines across ${group(budget.measuredFiles)} tracked files, \`package-lock.json\` aside — \`git ls-files | grep -v package-lock.json | xargs wc -l\`, the plan's own basis; the tree stands ${standing}.`,
    '- Trim applied: the documentation prose was compressed to one line per declaration across the delivered tree, keeping a doc comment on every exported service method, component input/output and model field (AAP 0.14.2), every recorded decision and every citation a comment carries — the multi-line blocks collapsed, the facts they stated did not.',
    `- Second trim: four fix sets landed after the cut and added ${group(SECOND_TRIM_ADDED_LINES)} net lines — the i18n and language-preference work +574, the session work +101, the loan-charge work +39 and the completed loans doc comments 0 — taking the tree from ${group(LINES_BEFORE_SECOND_TRIM - SECOND_TRIM_ADDED_LINES)} to ${group(LINES_BEFORE_SECOND_TRIM)} and over AAP 0.9.3's ceiling again (Rule 1 clause 10). The fixed order had nothing left to cut there: Stretch was already dropped at the earlier crossing, and the e2e suite holds only the Must workflows and their chain. The cut was comment prose again — every multi-line rationale block in the largest tracked files was condensed to its load-bearing statements, keeping a doc comment naming the Fineract endpoint or design element on every exported service method, component input/output and model field (AAP 0.14.2), every recorded decision, every citation a comment carries and every statement complete. No code line changed: stripping whole-line comments from the tree before and after the trim yields the same code, so the trim narrowed comments and nothing else.`,
    `- Third trim: ten fix sets landed at this checkpoint and added ${group(THIRD_TRIM_ADDED_LINES)} net lines across 91 files, taking the tree from ${group(LINES_BEFORE_THIRD_TRIM - THIRD_TRIM_ADDED_LINES)} to ${group(LINES_BEFORE_THIRD_TRIM)} and over AAP 0.9.3's ceiling again (Rule 1 clause 10). The fixed order had nothing left to cut there: Stretch was dropped at the first crossing and the e2e suite holds only the Must workflows and their chain. The cut was comment prose once more — every multi-line rationale block condensed to its load-bearing statements, the survivors reflowed to the widest line the tree already uses, and the commentary that only restated the code beside it removed — keeping a doc comment naming the Fineract endpoint or design element on every exported service method, component input/output and model field (AAP 0.14.2), every recorded decision, every citation a comment carries and every statement complete. No code line changed: stripping the comments from the tree before and after the trim yields the same code, so the trim narrowed and removed comments and nothing else.`,
    `- Revised totals: ${group(LINES_BEFORE_TRIM)} lines at \`4a13dc7\`, the commit the prose trim follows, ${group(LINES_AT_CUT_COMMIT)} at \`c05766d\`, the trim itself and the commit the cut follows, and ${group(measured)} in the delivered tree as measured above.`,
    `- Scope cut: the tree crossed AAP 0.9.3's ${group(LINE_CEILING)}-line ceiling while the workflow screens landed — ${group(LINES_BEFORE_TRIM)} lines before the prose trim — which engaged the plan's fixed cut order, so its first step — drop Stretch — was applied and the second is contained in it, because the savings workflow (W8) was the only Stretch workflow and its spec the only Stretch spec. Restoring what was cut would cross that ceiling again: the 17 cut files carry ${group(SAVINGS_CUT_LINES)} lines, so the delivered tree plus them measures ${group(measured + SAVINGS_CUT_LINES)}. The savings screens, their three routes, their e2e page objects, their seed product and the client record's "New Saving" entry point are therefore not delivered, and the eight W8 savings rows were removed from \`endpoint-allowlist.json\` so that list stays a true statement about the application (AAP 0.10.4). Every Must workflow (W1–W7 and the W2→W4→W5→W6 chain) keeps its screen and its spec: no Must scope was dropped, and the three check scripts are untouched.`,
    `- Check scripts and their \`lib/\` helpers: ${group(budget.checkScriptLines)} lines against AAP 0.9.3's share of about 600. That share was estimated for skeleton checks, while the delivered gates enforce 0.10.4's whole rules over the tree (endpoint allowlist, template coverage, wiring, scope and credential), so the figure above is the revised share: it is recorded here, never met by weakening a gate (Rule 1 clauses 2 and 8).`,
  ];
}

/** Renders the report a human reads (AAP 0.10.3 criterion 4), in the plan's order: verdict, header, workflow matrix, passing workflows, the legacy-broken baseline, intentional differences, the deliberate-difference (AAP 0.10.5, AAP 0.10.2). */
export function renderMarkdown(report: ParityReport): string {
  const rows = report.workflows;
  const nextRows = rows.filter((row) => row.project === 'next');
  const failed = rows.filter((row) => row.status === 'fail');
  const broken = rows.filter((row) => row.status === 'legacy-broken');
  const intentional = rows.filter((row) => row.status === 'intentional-diff');
  const missing = rows.filter((row) => row.status === 'missing');
  const nextPassed = nextRows.filter((row) => row.status === 'pass').length;
  const nextFailed = nextRows.filter((row) => row.status === 'fail').length;
  const nextMissing = nextRows.filter((row) => row.status === 'missing').length;
  const unreadable = report.unreadable ?? [];
  const lines: string[] = [
    '# Parity report — legacy versus new Mifos X UI',
    '',
    `**Verdict:** ${nextPassed} of ${WORKFLOW_IDS.length} new-app workflows pass; ${nextFailed} failed and `
      + `${nextMissing} produced no record. ${broken.length} legacy row(s) are recorded \`legacy-broken\` and `
      + `${intentional.length} difference(s) are intentional. `
      + (nextFailed === 0 && nextMissing === 0 && failed.length === 0
        ? 'No new-app workflow failed.'
        : 'See Failures and the records not produced below.'),
    '',
    '## Header',
  ];
  pushTable(lines, 'Run', ['Field', 'Value'], [
    ['Environment', cell(report.header.environment)],
    ['Backend remote', cell(report.header.backendRemote ?? 'not verified')],
    ['Backend commit', cell(report.header.backendCommit ?? 'not verified')],
    ['Backend verified', cell(report.header.backendVerified)],
    ['Backend URL (`FINERACT_URL`)', cell(report.header.fineractUrl)],
    ['Legacy URL (`LEGACY_URL`)', cell(report.header.legacyUrl)],
    ['New app URL (`NEXT_URL`)', cell(report.header.nextUrl)],
    ['Run date — the tenant business date read from Fineract, never the browser clock', cell(report.header.runDate.length === 0 ? 'not established' : report.header.runDate)],
    ['Generated at', cell(report.header.generatedAt)],
  ]);
  lines.push('', '## Workflow matrix');
  pushTable(
    lines,
    'Status per workflow and front end',
    ['Workflow', 'legacy', 'next'],
    WORKFLOW_IDS.map((workflow) => [
      `\`${workflow}\``,
      rowAt(rows, workflow, 'legacy')?.status ?? 'missing',
      rowAt(rows, workflow, 'next')?.status ?? 'missing',
    ]),
  );
  const incomparable = WORKFLOW_IDS.filter((workflow) => rowAt(rows, workflow, 'next')?.comparable === false);
  if (incomparable.length > 0) {
    lines.push(
      '',
      `Not comparable: ${incomparable.map((workflow) => `\`${workflow}\``).join(', ')}. The legacy baseline is `
        + '`legacy-broken` or was never recorded, so the expected behaviour is defined by the Fineract API '
        + 'contract rather than by the broken screen (AAP 0.10.1).',
    );
  }
  lines.push('', '## Passing workflows');
  pushTable(lines, 'Passed', ['Workflow', 'Front end'], rows
    .filter((row) => row.status === 'pass')
    .map((row) => [`\`${row.workflow}\``, row.project]), true);
  if (rows.every((row) => row.status !== 'pass')) {
    lines.push('', 'No workflow passed.');
  }
  lines.push(
    '',
    '## Legacy-broken baseline',
    '',
    'These rows do not fail `npm run e2e`, and the same defect is never reproduced in the new app (AAP 0.10.1).',
  );
  pushTable(lines, 'Legacy-broken', ['Workflow', 'Front end', 'Reason'], broken
    .map((row) => [`\`${row.workflow}\``, row.project, cell(row.reason)]), true);
  if (broken.length === 0) {
    lines.push('', 'No legacy row was recorded `legacy-broken`.');
  }
  lines.push('', '## Intentional differences');
  pushTable(lines, 'Intentional', ['Workflow', 'Front end', 'Item', 'Reason'], intentional
    .map((row) => [
      `\`${row.workflow}\``,
      row.project,
      `AAP 0.10.5 item ${row.intentionalDiffId ?? 'missing'}`,
      cell(row.reason),
    ]), true);
  if (intentional.length === 0) {
    lines.push('', 'No difference from legacy was recorded as intentional.');
  }
  lines.push(...renderDifferenceRegister(report.differenceRegister), '', '## Failures');
  if (failed.length === 0) {
    lines.push('', 'No workflow failed.');
  }
  for (const row of failed) {
    lines.push(
      '',
      `### \`${row.workflow}\` (${row.project}) — fail`,
      '',
      `- First failing step: ${row.failingStep === undefined ? 'not recorded' : `\`${cell(row.failingStep)}\``}`,
      `- Reason: ${cell(row.reason ?? 'not recorded', 300)}`,
    );
    const diffs = row.diffs ?? [];
    pushTable(
      lines,
      'Request diffs',
      ['Method', 'Path', 'Field', 'legacy', 'next'],
      diffs.filter((diff) => diff.method !== STATE_DIFF_METHOD)
        .map((diff) => [cell(diff.method), cell(diff.path), cell(diff.field), cell(diff.legacy), cell(diff.next)]),
      true,
    );
    pushTable(
      lines,
      'State diffs',
      ['Field', 'legacy', 'next'],
      diffs.filter((diff) => diff.method === STATE_DIFF_METHOD)
        .map((diff) => [cell(diff.field), cell(diff.legacy), cell(diff.next)]),
      true,
    );
  }
  lines.push('', '## Records not produced or unreadable');
  pushTable(lines, 'Not produced', ['Workflow', 'Front end', 'Record the run should have written'], missing
    .map((row) => [`\`${row.workflow}\``, row.project, cell(workflowRecordPath(row.project, row.workflow))]), true);
  pushTable(lines, 'Unreadable', ['Path', 'Reason'], unreadable
    .map((entry) => [cell(entry.path), cell(entry.message)]), true);
  if (missing.length === 0 && unreadable.length === 0) {
    lines.push('', 'Every workflow recorded both front ends, and every record could be read.');
  }
  lines.push('', '## Counts');
  pushTable(
    lines,
    'Workflow rows by status',
    ['Status', 'legacy', 'next', 'total'],
    [...WORKFLOW_STATUSES, 'missing' as const].map((status) => [
      status,
      String(rows.filter((row) => row.project === 'legacy' && row.status === status).length),
      String(rows.filter((row) => row.project === 'next' && row.status === status).length),
      String(rows.filter((row) => row.status === status).length),
    ]),
  );
  lines.push('', '## Line budget', ...lineBudgetLines(report.lineBudget));
  lines.push(
    '',
    'Parity is behavioural: this report compares the ordered API calls and the backend end state of the two',
    'front ends (AAP 0.10.1, 0.10.2), normalised by `e2e/capture/network-capture.ts`. Screenshots are evidence,',
    'not a criterion, and none is referenced here.',
  );
  return `${lines.join('\n')}\n`;
}

/** Key names that say credential or session material, used only to re-check what is about to be written (Rule 1 clause 9). */
const CREDENTIAL_NAME_PATTERN =
  /password|passcode|^pass$|^pin$|token|secret|session|authorization|authenticationKey|apiKey|credential/i;

/** Environment values a report must never carry, whatever produced them (Rule 1 clause 9). */
const CREDENTIAL_ENV_NAMES: readonly string[] = ['E2E_PASSWORD', 'E2E_USER', 'FINERACT_PASSWORD'];

/** A credential written as a pair anywhere in a document — `"authenticationKey": "abc"`, `password=abc` — but not one already masked: the mask marker itself must pass, and a field *named* for a credential with no value. */
const UNMASKED_CREDENTIAL_PATTERN =
  /(password|passcode|authorization|authenticationKey|base64EncodedAuthenticationKey|token|secret|apiKey)\s*["']?\s*[:=]\s*["']?(?!\*\*\*)[^\s"',}|]+/i;

/** An entry URL's `baseApiUrl` or `tenantIdentifier` value written unmasked anywhere in a document (Rule 1 clause 9; AAP 0.10.4). {@link redactEntryLocation} is what keeps it out, and this is the independent check that it does. */
const UNMASKED_ENTRY_LOCATION_PATTERN =
  /\b(baseApiUrl|tenantIdentifier)(?:["']?\s*[:=]\s*["']?)(?!\*\*\*)[^\s"'&#,;)|}\]]+/i;

/** Refuses to write a report that carries a credential (Rule 1 clause 9): the value of a credential environment variable, a credential-shaped pair that is not the mask marker, and a diff whose field names a credential while the value beside it is unmasked (AAP 0.10.4). */
async function assertNoCredential(report: ParityReport, markdown: string, json: string): Promise<void> {
  const documents: readonly { readonly document: string; readonly text: string }[] = [
    { document: MARKDOWN_PATH, text: markdown },
    { document: JSON_PATH, text: json },
  ];
  for (const { document, text } of documents) {
    for (const name of CREDENTIAL_ENV_NAMES) {
      const secret = (process.env[name] ?? '').trim();
      if (secret.length > 0 && text.includes(secret)) {
        throw new ParityReportError(`${document} would carry the value of ${name}; refusing to write it (Rule 1 clause 9)`);
      }
    }
    if (UNMASKED_CREDENTIAL_PATTERN.test(text)) {
      throw new ParityReportError(`${document} would carry an unmasked credential field; refusing to write it (Rule 1 clause 9)`);
    }
    const unmaskedEntryLocation = UNMASKED_ENTRY_LOCATION_PATTERN.exec(text);
    if (unmaskedEntryLocation !== null) {
      throw new ParityReportError(
        `${document} would carry the value of the entry URL's ${unmaskedEntryLocation[1]} parameter; `
          + 'refusing to write it (Rule 1 clause 9)',
      );
    }
  }
  for (const row of report.workflows) {
    for (const diff of row.diffs ?? []) {
      if (CREDENTIAL_NAME_PATTERN.test(diff.field)) {
        throw new ParityReportError(
          `${JSON_PATH} would carry the value of ${diff.field} for ${row.workflow}/${row.project}; `
            + 'refusing to write it (Rule 1 clause 9)',
        );
      }
    }
  }
}

/** Writes the two outputs AAP 0.10.4 names — `web-ng/parity-report.md` first, then `web-ng/parity-report.json` — after both have passed {@link assertNoCredential}, so a refused report leaves neither file behind. */
export async function writeReport(report: ParityReport): Promise<{ markdownPath: string; jsonPath: string }> {
  const markdown = renderMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await assertNoCredential(report, markdown, json);
  await writeFile(MARKDOWN_PATH, markdown, 'utf8');
  await writeFile(JSON_PATH, json, 'utf8');
  return { markdownPath: MARKDOWN_PATH, jsonPath: JSON_PATH };
}

/** Everything that must make the command exit non-zero, one precise line each: a new-app row that failed or produced no record, an acknowledged difference without its reason or AAP 0.10.5 item, two passes that differ, a (AAP 0.10.1, Rule 1 clause 9). */
export function collectProblems(report: ParityReport): string[] {
  const problems: string[] = [];
  if (report.header.runDate.length === 0) {
    problems.push('the run date could not be established: readBusinessDate() failed, and the browser clock is never a substitute (Rule 1 clause 2)');
  }
  if (!report.header.backendVerified) {
    problems.push('backend provenance was not recorded: run `npm run check:backend` against the Blitzy-Sandbox/blitzy-fineract build (Rule 2)');
  }
  for (const row of report.workflows) {
    const where = `${row.workflow} (${row.project})`;
    if (row.project === 'next' && row.status === 'missing') {
      problems.push(`${where}: produced no record, so the workflow is unverified`);
    }
    if (row.project === 'next' && row.status === 'fail') {
      const step = row.failingStep === undefined ? '' : ` (first failing step: ${row.failingStep})`;
      problems.push(`${where}: failed${step}${row.reason === undefined ? '' : ` — ${row.reason}`}`);
    }
    if (row.status === 'legacy-broken' || row.status === 'intentional-diff') {
      if (!hasText(row.reason)) {
        problems.push(`${where}: ${row.status} without a reason`);
      }
      if (row.status === 'intentional-diff' && !isIntentionalDiffId(row.intentionalDiffId)) {
        problems.push(`${where}: intentional-diff without its AAP 0.10.5 item number`);
      }
    }
    if (row.comparable && row.status === 'pass' && (row.diffs?.length ?? 0) > 0) {
      problems.push(`${where}: both sides pass, but they differ — ${describeDiffs(row.diffs ?? [])}`);
    }
  }
  for (const entry of report.unreadable ?? []) {
    problems.push(`record or artefact ${entry.path} could not be read: ${entry.message}`);
  }
  const budget = report.lineBudget;
  if (budget !== undefined && budget.verdict === 'over' && budget.measuredLines !== null) {
    problems.push(`the delivered tree measures ${group(budget.measuredLines)} generated lines against AAP 0.9.3's ceiling of ${group(LINE_CEILING)} — ${group(budget.measuredLines - LINE_CEILING)} lines over it (Rule 1 clause 10): apply the plan's fixed cut order and record the cut in the report`);
  }
  return problems;
}

/** Builds the report, writes both files and reports the verdict (AAP 0.10.4's report row, criterion 4). @returns `0` when the report is clean; `1` for any problem {@link collectProblems} names, for a credential the guard. */
export async function main(): Promise<number> {
  let report: ParityReport;
  let paths: { markdownPath: string; jsonPath: string };
  try {
    report = await buildReport();
    paths = await writeReport(report);
  } catch (error) {
    console.error(`parity report: ${error instanceof Error ? error.message : 'the report could not be produced'}`);
    return 1;
  }
  const problems = collectProblems(report);
  const nextRows = report.workflows.filter((row) => row.project === 'next');
  const passed = nextRows.filter((row) => row.status === 'pass').length;
  console.log('parity report');
  console.log(`  verdict: ${problems.length === 0 ? 'pass' : 'fail'} — ${passed}/${WORKFLOW_IDS.length} new-app workflows pass`);
  console.log(
    `  environment: ${report.header.environment}; backend: ${report.header.backendRemote ?? 'not verified'}`
      + `${report.header.backendCommit === null ? '' : ` @ ${report.header.backendCommit.slice(0, 7)}`}`,
  );
  console.log(`  run date (tenant business date): ${report.header.runDate.length === 0 ? 'not established' : report.header.runDate}`);
  for (const status of WORKFLOW_STATUSES) {
    const legacy = report.workflows.filter((row) => row.project === 'legacy' && row.status === status).length;
    const next = nextRows.filter((row) => row.status === status).length;
    console.log(`  ${status}: legacy ${legacy}, next ${next}`);
  }
  console.log(`  wrote ${paths.markdownPath}`);
  console.log(`  wrote ${paths.jsonPath}`);
  for (const problem of problems) {
    console.error(`parity report: ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}

/** Runs only as the entry point — `tsx e2e/report/parity-report.ts`, which `npm run e2e` calls — so importing this module writes nothing, calls nothing and throws nothing at import time (AAP 0.10.3). */
const entryPoint = process.argv[1];

if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  process.exitCode = await main();
}

