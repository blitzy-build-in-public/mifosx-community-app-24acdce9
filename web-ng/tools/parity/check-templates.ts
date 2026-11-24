/// <reference types="node" />
// npm run check:templates — AAP 0.10.4 row 2, criterion 6. Every Fineract template endpoint the in-scope screens take
// their dropdowns and defaults from (Rule 1 clause 3) must be called from web-ng/src/app.
//
// The expected set below is transcribed from the AAP 0.7.3 endpoint table, not scanned out of the legacy tree: this base
// commit ships no app/ directory, and a legacy tree that cannot be read is reported as a note and never as a failure
// (Rule 1 clause 1). A template endpoint the table does not name is a finding for the plan to record, never an entry to
// invent (Rule 1 clause 2), which is why an unexpected legacy call is reported at its own file:line.
//
// Coverage is path-and-marker based. An item passes when one non-spec file under web-ng/src/app names the item's
// canonical path — canonicalised exactly as check-endpoints.ts does — and holds every marker token the item requires.
// That pairs `/loans/{}/template` with the service that composes it and sets `templateType=approval` without parsing how
// a query string is built, and it recognises both call shapes: a template literal, and `'/a/' + id + '/b'`.
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegacyTemplateCall, LegacyTree } from './lib/legacy-scan.js';
import { findLegacyTemplateCalls, scanLegacyTree } from './lib/legacy-scan.js';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import { canonicalPath, findUrlLiterals, isStaticAsset, readText, stripComments, walk } from './lib/source-scan.js';

/** `web-ng/`, resolved from this file's URL and never from `process.cwd()`. */
const webNgRoot: string = fileURLToPath(new URL('../../', import.meta.url));
/** Repository root, so every reported path is repo-relative and identical on every machine. */
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'check:templates';
const RULE = 'template-coverage';
const APP_ROOT = join(webNgRoot, 'src', 'app');
const ALLOWLIST_FILE = 'endpoint-allowlist.json';
const ALLOWLIST_SHOWN = `web-ng/tools/parity/${ALLOWLIST_FILE}`;
/** Printed verbatim when app/scripts cannot be read, so CI output says why the set is the plan's table (AAP 0.10.4). */
const LEGACY_ABSENT = 'LEGACY TREE ABSENT: app/scripts could not be read (base commit holds only README.md) — the expected template set is built from AAP 0.7.3 alone, not from a legacy scan.';
/** A template resource named by legacy code; the only legacy token that can be joined to a catalogued endpoint. */
const TEMPLATE_RESOURCE = /^[A-Za-z_$][\w$]*Template\w*Resource$/;

/** One template endpoint the in-scope screens need, with the tokens that prove a file makes the call the plan means. */
interface ExpectedTemplate {
  id: string;
  /** Path under apiPath, `{}` for an identifier segment, query string omitted. */
  canonicalPath: string;
  /** Tokens the calling file must also hold: they separate two calls that share one canonical path. */
  markers: string[];
  family: string;
  /** Workflow row of the AAP 0.7.3 table this item transcribes. */
  source: string;
  note: string;
}

/** The AAP 0.7.3 template endpoints, keyed by `id` because items 1 and 4 share one canonical path. */
const EXPECTED: readonly ExpectedTemplate[] = [
  { id: 'clients-create-template', canonicalPath: '/clients/template', markers: ['clients/template'], family: 'Clients', source: 'W2 create and activate client',
    note: 'create-form options; an office change resends officeId and staffInSelectedOfficeOnly' },
  { id: 'clients-record-template', canonicalPath: '/clients/{}', markers: ['template'], family: 'Clients', source: 'Client list and edit',
    note: 'the record and edit template, sent as ?template=true' },
  { id: 'clients-identifiers-template', canonicalPath: '/clients/{}/identifiers/template', markers: ['identifiers/template'], family: 'Clients', source: 'W3 search and view client',
    note: 'document-type options of the Identities tab' },
  { id: 'clients-action-template', canonicalPath: '/clients/template', markers: ['commandParam'], family: 'Clients', source: 'Client actions',
    note: 'closure and rejection reasons of close, reject and withdraw, selected by commandParam' },
  { id: 'loans-application-template', canonicalPath: '/loans/template', markers: ['loans/template'], family: 'Loans', source: 'W4 loan application',
    note: 'templateType=individual with clientId and productId' },
  { id: 'loans-edit-template', canonicalPath: '/loans/{}', markers: ['template'], family: 'Loans', source: 'Loan edit',
    note: '?template=true with associations=charges,collateral,meeting,multiDisburseDetails' },
  { id: 'loans-action-template', canonicalPath: '/loans/{}/template', markers: ['/template'], family: 'Loans', source: 'W5 approve and disburse',
    note: 'templateType=approval, and the same path carries the disbursal template' },
  { id: 'loans-transactions-template', canonicalPath: '/loans/{}/transactions/template', markers: ['transactions/template'], family: 'Loans', source: 'W5 approve and disburse, W6 repayment',
    note: 'command=disburse and command=repayment' },
  { id: 'loans-charges-template', canonicalPath: '/loans/{}/charges/template', markers: ['charges/template'], family: 'Loans', source: 'Loan charges',
    note: 'charge options of the add-charge form' },
  { id: 'loans-schedule-preview', canonicalPath: '/loans', markers: ['calculateLoanSchedule'], family: 'Loans', source: 'W4 loan application',
    note: 'the repayment-schedule preview posted to command=calculateLoanSchedule' },
  { id: 'savings-application-template', canonicalPath: '/savingsaccounts/template', markers: ['savingsaccounts/template'], family: 'Savings', source: 'W8 savings',
    note: 'product and field options of the savings application' },
  { id: 'savings-transactions-template', canonicalPath: '/savingsaccounts/{}/transactions/template', markers: ['transactions/template'], family: 'Savings', source: 'W8 savings',
    note: 'payment types of deposit and withdrawal' },
  { id: 'search-template', canonicalPath: '/search/template', markers: ['search/template'], family: 'Search', source: 'Shell: global search',
    note: 'the search scope template' },
  { id: 'loan-charge-template', canonicalPath: '/charges/{}', markers: ['charges/', 'template'], family: 'Loans', source: 'W4 loan application',
    note: 'GET /charges/{id}?template=true, the loan charge amount template' },
];

/** A canonical path with the line that first names it. */
interface PathRef { canonical: string; line: number }
/** One scanned application file: comment-free text for marker tests, and the canonical paths it names. */
interface FileScan { file: string; text: string; paths: PathRef[]; literals: number }
/** The allowlist joined to EXPECTED: every declared endpoint, and the resources the table already covers. */
interface AllowlistIndex { apiPath: string; declared: Set<string>; templateResources: Set<string> }

/** A thrown value is arbitrary data; only the message a reader can act on is kept. */
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A JSON object, the only shape a data file may present; anything else is a load failure. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Reads endpoint-allowlist.json (Rule 1 clause 2) and joins its rows to EXPECTED; `null` when it cannot be read. */
async function loadAllowlist(violations: Violation[]): Promise<AllowlistIndex | null> {
  const location = new URL(`./${ALLOWLIST_FILE}`, import.meta.url);
  try {
    // The list is data read from disk, so it arrives as unknown and every field below is narrowed before it is used.
    const document = asRecord(JSON.parse(await readText(fileURLToPath(location))));
    const apiPath = document === null ? undefined : asRecord(document['header'])?.['apiPath'];
    const entries = document === null ? undefined : document['entries'];
    if (typeof apiPath !== 'string' || !Array.isArray(entries)) throw new Error('the file needs header.apiPath and an entries array');
    const index: AllowlistIndex = { apiPath, declared: new Set(), templateResources: new Set() };
    const expected = new Set(EXPECTED.map((item) => canonicalPath(apiPath + item.canonicalPath)));
    for (const entry of entries as unknown[]) {
      const row = asRecord(entry);
      const path = row === null ? undefined : row['path'];
      const resource = row === null ? undefined : row['resource'];
      if (typeof path !== 'string') continue;
      const declared = canonicalPath(apiPath + path);
      index.declared.add(declared);
      if (expected.has(declared) && typeof resource === 'string') index.templateResources.add(resource);
    }
    return index;
  } catch (error) {
    // The OS error names an absolute path, so it is rewritten to the repo-relative one for a machine-independent log.
    const reason = describe(error).split(fileURLToPath(location)).join(ALLOWLIST_SHOWN);
    violations.push(violation('endpoint-allowlist', ALLOWLIST_SHOWN, 0, `cannot be read, so the expected template rows cannot be joined to the declared endpoints: ${reason}`));
    return null;
  }
}

/** Two quoted literals joined by a `+` expression, newline-free, so rewriting it leaves every line number intact. */
const CONCATENATED = /(['"`])[ \t]*\+[ \t]*[^'"`;\n]{1,60}?\+[ \t]*(['"`])/g;

/** Canonical paths of one literal: the path itself, and the path with a leading `${apiPath}` segment dropped. */
function canonicalCandidates(value: string): string[] {
  const canonical = canonicalPath(value.startsWith('/') ? value : `/${value}`);
  const headless = canonical.startsWith('/{}/') ? canonical.slice(3) : null;
  return headless === null ? [canonical] : [canonical, headless];
}

/** Reads one file once: its comment-free text, every canonical path it names, and how many literals were judged. */
async function scanSource(file: string): Promise<FileScan> {
  const text = stripComments(await readText(file));
  const merged = text.replace(CONCATENATED, '{}');
  // Both passes, so a rewritten concatenation never hides a path the plain literals already name; a literal that both
  // passes report is read once.
  const readings = [...findUrlLiterals(text), ...(merged === text ? [] : findUrlLiterals(merged))];
  const seen = new Set<string>();
  const paths = new Map<string, number>();
  let literals = 0;
  for (const literal of readings) {
    const reading = `${literal.line}:${literal.value}`;
    if (seen.has(reading) || isStaticAsset(literal.value)) continue;
    seen.add(reading);
    literals += 1;
    for (const canonical of canonicalCandidates(literal.value)) if (!paths.has(canonical)) paths.set(canonical, literal.line);
  }
  const named = [...paths].map(([canonical, line]) => ({ canonical, line }));
  return { file: relative(repoRoot, file).split(sep).join('/'), text, paths: named, literals };
}

await runCheck(CHECK, async (): Promise<CheckOutcome> => {
  const violations: Violation[] = [];
  const notes: string[] = [];
  const fail = (file: string, line: number, message: string): void => { violations.push(violation(RULE, file, line, message)); };
  const appRootShown = relative(repoRoot, APP_ROOT).split(sep).join('/');
  const outcome = (files: number, urlLiterals: number, covered: number): CheckOutcome =>
    ({ check: CHECK, violations, notes, scanned: { files, urlLiterals, expected: EXPECTED.length, covered } });

  const index = await loadAllowlist(violations);
  if (index === null) return outcome(0, 0, 0);
  // The plan's table and its allowlist are two statements of one contract (Rule 1 clause 2), so a row missing from the
  // allowlist is reported here: this file is exempt from check:endpoints' own literal scan as a checker.
  for (const item of EXPECTED) {
    const declared = canonicalPath(index.apiPath + item.canonicalPath);
    if (!index.declared.has(declared)) violations.push(violation('endpoint-allowlist', ALLOWLIST_SHOWN, 0, `${declared} is required by the AAP 0.7.3 template row ${item.id} but is not declared in ${ALLOWLIST_SHOWN}`));
  }

  let files: string[];
  try {
    files = await walk(APP_ROOT, { extensions: ['.ts'] });
  } catch (error) {
    // A tree that cannot be read is not a tree that passed, so it fails at line 0 as check:endpoints does for a root.
    fail(appRootShown, 0, describe(error).split(APP_ROOT).join(appRootShown));
    return outcome(0, 0, 0);
  }
  const scans: FileScan[] = await Promise.all(files.filter((file) => !file.endsWith('.spec.ts')).map(scanSource));
  const urlLiterals = scans.reduce((total, scan) => total + scan.literals, 0);
  let covered = 0;
  for (const item of EXPECTED) {
    const calling = scans.filter((scan) => scan.paths.some((path) => path.canonical === item.canonicalPath));
    if (calling.some((scan) => item.markers.every((marker) => scan.text.includes(marker)))) {
      covered += 1;
      continue;
    }
    // The finding sits at the first line of the file that came closest: the lowest-ordered caller of the path, or the
    // root itself at line 0 when no file calls it at all.
    const first = calling.at(0);
    const line = first?.paths.find((path) => path.canonical === item.canonicalPath)?.line ?? 0;
    const absent = item.markers.filter((marker) => !calling.some((scan) => scan.text.includes(marker)));
    const markers = (absent.length === 0 ? item.markers : absent).join(', ');
    fail(first?.file ?? appRootShown, line, `${item.id}: ${item.canonicalPath} is uncovered — no file under ${appRootShown} calls it while holding the marker(s) ${markers}, and the ${item.family} screens need it for ${item.note} (${item.source})`);
  }

  const tree: LegacyTree = await scanLegacyTree();
  if (!tree.present) {
    notes.push(LEGACY_ABSENT);
  } else {
    // A legacy call carries a resource name rather than a path, so the plan's table is joined to it through the
    // allowlist's `resource` column: a template resource the table already records at an expected path is covered.
    const calls: LegacyTemplateCall[] = await findLegacyTemplateCalls(tree);
    const reported = new Set<string>();
    for (const call of calls) {
      if (!TEMPLATE_RESOURCE.test(call.resource) || index.templateResources.has(call.resource)) continue;
      if (reported.has(`${call.file}:${call.line}`)) continue;
      reported.add(`${call.file}:${call.line}`);
      fail(call.file, call.line, `${call.resource} is a template resource that no expected row of the AAP 0.7.3 table names, so this legacy call may fetch options the new services do not — record the missing row in the plan rather than adding an endpoint`);
    }
  }

  return outcome(scans.length, urlLiterals, covered);
});
