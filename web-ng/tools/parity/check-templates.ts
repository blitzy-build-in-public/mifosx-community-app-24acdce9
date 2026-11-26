// npm run check:templates — AAP 0.10.4 row 2, criterion 6. Fails on any AAP 0.7.3 template endpoint (Rule 1 clause 3) that no non-spec file under web-ng/src/app calls while holding that row's markers; the expected set is (Rule 1 clause 2, Rule 1 clause 1).
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from './lib/cli.js';
import type { LegacyTemplateCall, LegacyTree } from './lib/legacy-scan.js';
import { findLegacyResourcePaths, findLegacyTemplateCalls, scanLegacyTree } from './lib/legacy-scan.js';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import { canonicalPath, findUrlLiterals, isStaticAsset, readText, stripComments, walk } from './lib/source-scan.js';
const webNgRoot: string = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'check:templates';
const RULE = 'template-coverage';
const APP_ROOT = join(webNgRoot, 'src', 'app');
const ALLOWLIST_FILE = 'endpoint-allowlist.json';
const ALLOWLIST_SHOWN = `web-ng/tools/parity/${ALLOWLIST_FILE}`;
const LEGACY_ABSENT = 'LEGACY TREE ABSENT: app/scripts could not be read (base commit holds only README.md) — the expected template set is built from AAP 0.7.3 alone, not from a legacy scan.';
/** Route families this migration delivers; a legacy template call under one of them must have an equivalent here. */
const IN_SCOPE = ['/clients', '/loans', '/search', '/datatables'];
const OUT_OF_SCOPE = ['/clients/{}/collaterals', '/loans/{}/collaterals'];
/** A legacy token shaped like a resource factory key; a legacy scan's other matches name a property, never a resource. */
const RESOURCE_REFERENCE = /^[A-Za-z_$][\w$]*Resource$/;
type Marker = string | RegExp;
/** One template endpoint the in-scope screens need, with the markers that prove a file makes the call the plan means. */
interface ExpectedTemplate {
  id: string;
  /** Path under apiPath, `{}` for an identifier segment, query string omitted. */
  canonicalPath: string;
  markers: Marker[];
  family: string;
  /** Workflow row of the AAP 0.7.3 table this item transcribes. */
  source: string;
  note: string;
}
/** The AAP 0.7.3 template endpoints, keyed by `id` because items 1 and 4 share one canonical path. */
const EXPECTED: readonly ExpectedTemplate[] = [
  { id: 'clients-create-template', canonicalPath: '/clients/template', markers: ['clients/template'], family: 'Clients', source: 'W2 create and activate client',
    note: 'create-form options; an office change resends officeId and staffInSelectedOfficeOnly' },
  { id: 'clients-record-template', canonicalPath: '/clients/{}', markers: [/template['"]?\s*[:=,]\s*['"]?true/], family: 'Clients', source: 'Client list and edit',
    note: 'the record and edit template, sent as ?template=true' },
  { id: 'clients-identifiers-template', canonicalPath: '/clients/{}/identifiers/template', markers: ['identifiers/template'], family: 'Clients', source: 'W3 search and view client',
    note: 'document-type options of the Identities tab' },
  { id: 'clients-action-template', canonicalPath: '/clients/template', markers: ['commandParam'], family: 'Clients', source: 'Client actions',
    note: 'closure and rejection reasons of close, reject and withdraw, selected by commandParam' },
  { id: 'loans-application-template', canonicalPath: '/loans/template', markers: ['loans/template'], family: 'Loans', source: 'W4 loan application',
    note: 'templateType=individual with clientId and productId' },
  { id: 'loans-edit-template', canonicalPath: '/loans/{}', markers: [/associations['"]?\s*[:=,]\s*['"]?charges/], family: 'Loans', source: 'Loan edit',
    note: '?template=true with associations=charges,collateral,meeting,multiDisburseDetails' },
  { id: 'loans-action-template', canonicalPath: '/loans/{}/template', markers: ['/template'], family: 'Loans', source: 'W5 approve and disburse',
    note: 'templateType=approval, and the same path carries the disbursal template' },
  { id: 'loans-transactions-template', canonicalPath: '/loans/{}/transactions/template', markers: ['transactions/template'], family: 'Loans', source: 'W5 approve and disburse, W6 repayment',
    note: 'command=disburse and command=repayment' },
  { id: 'loans-charges-template', canonicalPath: '/loans/{}/charges/template', markers: ['charges/template'], family: 'Loans', source: 'Loan charges',
    note: 'charge options of the add-charge form' },
  { id: 'loans-schedule-preview', canonicalPath: '/loans', markers: ['calculateLoanSchedule'], family: 'Loans', source: 'W4 loan application',
    note: 'the repayment-schedule preview posted to command=calculateLoanSchedule' },
  { id: 'search-template', canonicalPath: '/search/template', markers: ['search/template'], family: 'Search', source: 'Shell: global search',
    note: 'the search scope template' },
  { id: 'loan-charge-template', canonicalPath: '/charges/{}', markers: ['charges/', 'template'], family: 'Loans', source: 'W4 loan application',
    note: 'GET /charges/{id}?template=true, the loan charge amount template' },
];
interface PathRef { canonical: string; line: number }
interface OutsideCall { count: number; first: string; resource: string; route: string }
interface FileScan { file: string; text: string; paths: PathRef[]; literals: number }
interface AllowlistIndex { apiPath: string; declared: Set<string> }
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const holdsMarker = (text: string, marker: Marker): boolean =>
  (typeof marker === 'string' ? text.includes(marker) : marker.test(text));
async function loadAllowlist(violations: Violation[]): Promise<AllowlistIndex | null> {
  const location = new URL(`./${ALLOWLIST_FILE}`, import.meta.url);
  try {
    const document = asRecord(JSON.parse(await readText(fileURLToPath(location))));
    const apiPath = document === null ? undefined : asRecord(document['header'])?.['apiPath'];
    const entries = document === null ? undefined : document['entries'];
    if (typeof apiPath !== 'string' || !Array.isArray(entries)) throw new Error('the file needs header.apiPath and an entries array');
    const index: AllowlistIndex = { apiPath, declared: new Set() };
    for (const entry of entries as unknown[]) {
      const row = asRecord(entry);
      const path = row === null ? undefined : row['path'];
      if (typeof path !== 'string') continue;
      index.declared.add(canonicalPath(apiPath + path));}
    return index;} catch (error) {
    const reason = describe(error).split(fileURLToPath(location)).join(ALLOWLIST_SHOWN);
    violations.push(violation('endpoint-allowlist', ALLOWLIST_SHOWN, 0, `cannot be read, so the expected template rows cannot be joined to the declared endpoints: ${reason}`));
    return null;
  }
}
const CONCATENATED = /(['"`])[ \t]*\+[ \t]*[^'"`;\n]{1,60}?\+[ \t]*(['"`])/g;
function canonicalCandidates(value: string): string[] {
  const canonical = canonicalPath(value.startsWith('/') ? value : `/${value}`);
  const headless = canonical.startsWith('/{}/') ? canonical.slice(3) : null;
  return headless === null ? [canonical] : [canonical, headless];
}
const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(prefix + '/');
const withinApi = (canonical: string, apiBase: string): string => (under(canonical, apiBase) ? canonical.slice(apiBase.length) : canonical);
function declaredPaths(apiPath: string, declared: string): string[] {
  const canonical = canonicalPath(apiPath + declared);
  const paths = [canonical];
  let shallower = canonical;
  while (shallower.endsWith('/{}')) {
    shallower = shallower.slice(0, -3);
    paths.push(shallower);
  }
  return paths;
}
async function scanSource(file: string): Promise<FileScan> {
  const text = stripComments(await readText(file));
  const merged = text.replace(CONCATENATED, '{}');
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
const TEMPLATES_USAGE: CliUsage = {
  name: 'check:templates',
  summary: 'Fails on any AAP 0.7.3 template endpoint that no file under web-ng/src/app calls.',
  effects: [
    'compares the twelve AAP 0.7.3 template endpoints with the calls the non-spec code under web-ng/src/app makes',
    'reports LEGACY TREE ABSENT as a note, never as a failure, when app/scripts cannot be read',
    'writes nothing: the gate only reads web-ng/src/app and the data files under web-ng/tools/parity',
  ],
  environment: [
    'none — the gate reads web-ng/src/app and the data files under web-ng/tools/parity and no environment variable',
  ],
  examples: [
    'npm run check:templates',
  ],
};
const intent = resolveCliIntent(TEMPLATES_USAGE, process.argv.slice(2));
if (intent.kind === 'handled') {
  process.exitCode = intent.exitCode;
}
if (intent.kind === 'run') await runCheck(CHECK, async (): Promise<CheckOutcome> => {
  const violations: Violation[] = [];
  const notes: string[] = [];
  const fail = (file: string, line: number, message: string): void => { violations.push(violation(RULE, file, line, message)); };
  const appRootShown = relative(repoRoot, APP_ROOT).split(sep).join('/');
  const outcome = (files: number, urlLiterals: number, covered: number): CheckOutcome =>
    ({ check: CHECK, violations, notes, scanned: { files, urlLiterals, expected: EXPECTED.length, covered } });
  const index = await loadAllowlist(violations);
  if (index === null) return outcome(0, 0, 0);
  for (const item of EXPECTED) {
    const declared = canonicalPath(index.apiPath + item.canonicalPath);
    if (!index.declared.has(declared)) violations.push(violation('endpoint-allowlist', ALLOWLIST_SHOWN, 0, `${declared} is required by the AAP 0.7.3 template row ${item.id} but is not declared in ${ALLOWLIST_SHOWN}`));
  }
  let files: string[];
  try {
    files = await walk(APP_ROOT, { extensions: ['.ts'] });
  } catch (error) {
    fail(appRootShown, 0, describe(error).split(APP_ROOT).join(appRootShown));
    return outcome(0, 0, 0);
  }
  const scans: FileScan[] = await Promise.all(files.filter((file) => !file.endsWith('.spec.ts')).map(scanSource));
  const urlLiterals = scans.reduce((total, scan) => total + scan.literals, 0);
  let covered = 0;
  for (const item of EXPECTED) {
    const calling = scans.filter((scan) => scan.paths.some((path) => path.canonical === item.canonicalPath));
    if (calling.some((scan) => item.markers.every((marker) => holdsMarker(scan.text, marker)))) {
      covered += 1;
      continue;
    }
    const first = calling.at(0);
    const line = first?.paths.find((path) => path.canonical === item.canonicalPath)?.line ?? 0;
    const absent = item.markers.filter((marker) => !calling.some((scan) => holdsMarker(scan.text, marker)));
    const markers = (absent.length === 0 ? item.markers : absent).map((marker) => String(marker)).join(', ');
    fail(first?.file ?? appRootShown, line, `${item.id}: ${item.canonicalPath} is uncovered — no file under ${appRootShown} calls it while holding the marker(s) ${markers}, and the ${item.family} screens need it for ${item.note} (${item.source})`);
  }
  const tree: LegacyTree = await scanLegacyTree();
  if (!tree.present) {
    notes.push(LEGACY_ABSENT);
  } else {
    // A legacy call names a resource rather than a path, so the factory declaration joins the two sides; the route decides the verdict: covered, an in-scope gap, or a note.
    const factoryShown = relative(repoRoot, join(tree.scriptsRoot, 'services', 'ResourceFactoryProvider.js')).split(sep).join('/');
    const resources = await findLegacyResourcePaths(tree);
    if (resources === null) {
      fail(factoryShown, 0, `cannot be read, so no legacy template call can be resolved to the route it addresses and none of them can be reported on — restore the factory the legacy tree declares its resources in`);
    } else {
      const byName = new Map(resources.map((resource) => [resource.name, resource.path]));
      const expected = new Set(EXPECTED.map((item) => canonicalPath(index.apiPath + item.canonicalPath)));
      const apiBase = canonicalPath(index.apiPath);
      const calls: LegacyTemplateCall[] = await findLegacyTemplateCalls(tree);
      const elsewhere = new Map<string, OutsideCall>();
      for (const call of calls) {
        const declared = byName.get(call.resource);
        if (declared === undefined) {
          // Only a name shaped like a factory key addresses a route; a property that merely mentions a template (`scope.template`) is not reported.
          if (!RESOURCE_REFERENCE.test(call.resource)) continue;
          fail(call.file, call.line, `${call.resource} is not declared by ${factoryShown}, so the route this template call addresses cannot be established and its coverage is unknown — declare the resource in the legacy factory, or record the row the call belongs to in the plan rather than adding an endpoint`);
          continue;
        }
        const paths = declaredPaths(index.apiPath, declared);
        if (paths.some((path) => expected.has(path))) continue;
        const route = withinApi(paths[0], apiBase);
        if (IN_SCOPE.some((family) => under(route, family)) && !OUT_OF_SCOPE.some((feature) => under(route, feature))) {
          fail(call.file, call.line, `${call.resource} (${route}) is a legacy template call on an in-scope route that no expected row covers, so the new services fetch nothing for it — add the row and the call its screen needs, rather than an endpoint the plan does not name`);
          continue;
        }
        const key = `${call.resource} ${route}`;
        const seen = elsewhere.get(key);
        if (seen === undefined) elsewhere.set(key, { count: 1, first: `${call.file}:${call.line}`, resource: call.resource, route });
        else seen.count += 1;
      }
      for (const entry of [...elsewhere.values()].sort((left, right) =>
        (left.route < right.route ? -1 : left.route > right.route ? 1 : 0) || (left.resource < right.resource ? -1 : 1))) {
        notes.push(`${entry.resource} (${entry.route}) has ${entry.count} legacy call site(s), the first at ${entry.first} — the route is outside the in-scope routes this migration delivers, so no equivalent is required`);
      }
    }
  }
  return outcome(scans.length, urlLiterals, covered);
});
