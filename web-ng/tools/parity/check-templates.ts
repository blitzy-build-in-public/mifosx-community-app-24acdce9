/// <reference types="node" />
// npm run check:templates — AAP 0.10.4 row 2, criterion 6. Every Fineract template endpoint the in-scope screens take
// their dropdowns and defaults from (Rule 1 clause 3) must be called from web-ng/src/app.
//
// The expected set below is transcribed from the AAP 0.7.3 endpoint table, not scanned out of the legacy tree: this base
// commit ships no app/ directory, and a legacy tree that cannot be read is reported as a note and never as a failure
// (Rule 1 clause 1). A template endpoint the table does not name is a finding for the plan to record, never an entry to
// invent (Rule 1 clause 2), which is why an unexpected legacy call is reported at its own file:line.
//
// Coverage is path-and-marker based on both sides. An item passes when one non-spec file under web-ng/src/app names the
// item's canonical path — canonicalised exactly as check-endpoints.ts does — and holds every marker the item requires.
// That pairs `/loans/{}/template` with the service that composes it and sets `templateType=approval` without parsing how
// a query string is built, and it recognises both call shapes: a template literal, and `'/a/' + id + '/b'`.
//
// A legacy call is joined the same way. The resource it names is resolved to the path the legacy factory declares for it,
// and that path — never the allowlist's `resource` column, which records the plan's service labels — decides the verdict:
// a path the expected set holds is covered, one under an in-scope family is a finding, and one outside every in-scope
// family is a note, because the check covers the routes this migration delivers and nothing else.
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from './lib/cli.js';
import type { LegacyTemplateCall, LegacyTree } from './lib/legacy-scan.js';
import { findLegacyResourcePaths, findLegacyTemplateCalls, scanLegacyTree } from './lib/legacy-scan.js';
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
/** Route families this migration delivers; a legacy template call under one of them must have an equivalent here. */
const IN_SCOPE = ['/clients', '/loans', '/savingsaccounts', '/search', '/datatables'];
/** In-scope prefixes of an out-of-scope feature: collateral stays out of scope even on the in-scope client and loan records. */
const OUT_OF_SCOPE = ['/clients/{}/collaterals', '/loans/{}/collaterals'];
/** A legacy token shaped like a resource factory key; a legacy scan's other matches name a property, never a resource. */
const RESOURCE_REFERENCE = /^[A-Za-z_$][\w$]*Resource$/;

/** A marker: a token, or a pattern for a call shape a token cannot separate — a flag, rather than the word around it. */
type Marker = string | RegExp;

/** One template endpoint the in-scope screens need, with the markers that prove a file makes the call the plan means. */
interface ExpectedTemplate {
  id: string;
  /** Path under apiPath, `{}` for an identifier segment, query string omitted. */
  canonicalPath: string;
  /** Markers the calling file must also hold: they separate two calls that share one canonical path. */
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
/** A legacy route outside the in-scope families: the resource serving it, its first call site and its call count. */
interface OutsideCall { count: number; first: string; resource: string; route: string }
/** One scanned application file: comment-free text for marker tests, and the canonical paths it names. */
interface FileScan { file: string; text: string; paths: PathRef[]; literals: number }
/** The allowlist read for what this check needs: the API base every path sits under, and the declared endpoints. */
interface AllowlistIndex { apiPath: string; declared: Set<string> }

/** A thrown value is arbitrary data; only the message a reader can act on is kept. */
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A JSON object, the only shape a data file may present; anything else is a load failure. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** True when `text` carries one marker; patterns arrive flagless, so testing one never advances state a later test reads. */
const holdsMarker = (text: string, marker: Marker): boolean =>
  (typeof marker === 'string' ? text.includes(marker) : marker.test(text));

/** Reads endpoint-allowlist.json (Rule 1 clause 2): the API base, and every endpoint it declares; `null` when it cannot be read. */
async function loadAllowlist(violations: Violation[]): Promise<AllowlistIndex | null> {
  const location = new URL(`./${ALLOWLIST_FILE}`, import.meta.url);
  try {
    // The list is data read from disk, so it arrives as unknown and every field below is narrowed before it is used.
    const document = asRecord(JSON.parse(await readText(fileURLToPath(location))));
    const apiPath = document === null ? undefined : asRecord(document['header'])?.['apiPath'];
    const entries = document === null ? undefined : document['entries'];
    if (typeof apiPath !== 'string' || !Array.isArray(entries)) throw new Error('the file needs header.apiPath and an entries array');
    const index: AllowlistIndex = { apiPath, declared: new Set() };
    for (const entry of entries as unknown[]) {
      const row = asRecord(entry);
      const path = row === null ? undefined : row['path'];
      if (typeof path !== 'string') continue;
      index.declared.add(canonicalPath(apiPath + path));
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

/** True when `path` is `prefix` or lies below it segment by segment, so '/loanproducts' is never read as '/loans'. */
const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(prefix + '/');

/** The path below the API base, the form the scope lists are written in; the path itself when it sits outside that base. */
const withinApi = (canonical: string, apiBase: string): string => (under(canonical, apiBase) ? canonical.slice(apiBase.length) : canonical);

/**
 * The canonical form of one declared legacy path, then the same path with each trailing placeholder dropped: a legacy
 * resource that declares `:resourceType` and `:chargeId` serves every shallower member of its family, and the call, not
 * the declaration, is what decides which member it addresses.
 */
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

/**
 * What `--help` prints (finding 406f-F02): what the gate proves, that it writes nothing, the fact that
 * it reads no environment variable, and how it is run.
 */
const TEMPLATES_USAGE: CliUsage = {
  name: 'check:templates',
  summary: 'Fails on any AAP 0.7.3 template endpoint that no file under web-ng/src/app calls.',
  effects: [
    'compares the fourteen AAP 0.7.3 template endpoints with the calls the non-spec code under web-ng/src/app makes',
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

// A usage request is answered before the gate body runs, so `--help` reads no file and proves nothing
// (finding 406f-F02). The code goes on process.exitCode, never through process.exit(), so a piped
// summary line is never lost.
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
    if (calling.some((scan) => item.markers.every((marker) => holdsMarker(scan.text, marker)))) {
      covered += 1;
      continue;
    }
    // The finding sits at the first line of the file that came closest: the lowest-ordered caller of the path, or the
    // root itself at line 0 when no file calls it at all.
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
    // A legacy call carries a resource name rather than a path, so the factory's own declaration turns one into the other
    // and both sides are joined on the canonical path. The route a call addresses then decides its verdict: covered by an
    // expected row, a gap under an in-scope family, or a note for a route this migration does not deliver.
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
          // The legacy scan also matches a property that merely mentions a template (`scope.template`,
          // `inparams.templateType`). Only a name shaped like a factory key claims to address a route, so only that shape
          // is reported as missing: anything else is not a resource and addresses nothing.
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
        // A route this migration does not deliver asks nothing of the new services, so it becomes a note: the call stays
        // visible, with how many sites make it and where the first one is, instead of vanishing from the log.
        const key = `${call.resource} ${route}`;
        const seen = elsewhere.get(key);
        if (seen === undefined) elsewhere.set(key, { count: 1, first: `${call.file}:${call.line}`, resource: call.resource, route });
        else seen.count += 1;
      }
      // Ordered by route and then resource, so the log reads the same on every machine and every run.
      for (const entry of [...elsewhere.values()].sort((left, right) =>
        (left.route < right.route ? -1 : left.route > right.route ? 1 : 0) || (left.resource < right.resource ? -1 : 1))) {
        notes.push(`${entry.resource} (${entry.route}) has ${entry.count} legacy call site(s), the first at ${entry.first} — the route is outside the in-scope routes this migration delivers, so no equivalent is required`);
      }
    }
  }

  return outcome(scans.length, urlLiterals, covered);
});
