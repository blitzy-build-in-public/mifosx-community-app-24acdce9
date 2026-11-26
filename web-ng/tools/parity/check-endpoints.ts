// npm run check:endpoints — AAP 0.10.4 row 1, criterion 5: every Fineract URL under web-ng/src must be declared in endpoint-allowlist.json (Rule 1 clause 2) and no public demo host may appear anywhere (Rule 2) (AAP 0.8.2, AAP 0.10.2, AAP 0.14.1).
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from './lib/cli.js';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import type { Literal } from './lib/source-scan.js';
import { canonicalPath, findUrlLiterals, isStaticAsset, readText, stripComments, walk } from './lib/source-scan.js';
const webNgRoot: string = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
const APP_FILE = 'endpoint-allowlist.json';
const HARNESS_FILE = 'harness-allowlist.json';
const ROUTES_FILE = 'in-scope-routes.json';
const dataFile = (name: string): string => `web-ng/tools/parity/${name}`;
const TEXT_SUFFIXES: readonly string[] = ['.ts', '.js', '.mjs', '.cjs', '.html', '.json', '.scss', '.css', '.sh', '.yml', '.yaml'];
const SOURCE_SUFFIXES: readonly string[] = ['.ts', '.js'];
const SELF_SKIPPED: readonly string[] = ['check-endpoints.ts', 'check-templates.ts', 'check-wiring.ts', 'endpoint-allowlist.json', 'harness-allowlist.json', 'in-scope-routes.json', 'scope-allowlist.json'];
// Rule 2 names both hosts outright; the escaped dots keep this file's own source from matching its pattern.
const DEMO_HOST = /demo\.(?:mifos\.io|fineract\.dev)/;
const API_URL_CALL = /\bapiUrl\s*\(\s*(?=['"`])/g;
const LEGACY_NOTE = 'legacy tree app/ absent from this checkout: the app allowlist is transcribed from AAP 0.7.3, not generated from app/scripts/services/ResourceFactoryProvider.js';
const asRecord = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record === null ? undefined : record[key];
  return typeof value === 'string' ? value : null;};
const asRows = (record: Record<string, unknown>, key: string): Record<string, unknown>[] => {
  const value = record[key];
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null) : [];};
const column = (rows: Record<string, unknown>[], key: string): string[] => rows.map((row) => asString(row, key)).filter((value): value is string => value !== null);
async function loadList(name: string, rule: string, violations: Violation[]): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readText(fileURLToPath(new URL(`./${name}`, import.meta.url))));
    const document = asRecord(parsed);
    if (document === null) throw new Error('the file does not hold a JSON object');
    return document;
  } catch (error) {
    violations.push(violation(rule, dataFile(name), 0, `cannot be loaded: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}
function navigationPatterns(routes: string[]): string[][] {
  return routes.map((route) => canonicalPath(`/${route}`).split('/').filter((segment) => segment !== ''));
}
function isNavigationPath(patterns: string[][], path: string): boolean {
  const segments = canonicalPath(path).split('/').filter((segment) => segment !== '');
  return patterns.some((pattern) => segments.length <= pattern.length
    && segments.every((segment, position) => pattern[position] === '{}' || pattern[position] === segment));
}
const INTERPOLATION = '${';
function interpolationEnd(value: string, start: number): number {
  let depth = 0;
  for (let at = start + 1; at < value.length; at += 1) {
    const char = value.charAt(at);
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return at;}}
  return -1;}
function builderHead(value: string): string | null {
  const at = value.indexOf(INTERPOLATION);
  return at < 0 ? null : canonicalPath(value.slice(0, at));}
function isWholePathLiteral(value: string): boolean {
  return value.startsWith('/') && value.indexOf(INTERPOLATION) === 1 && interpolationEnd(value, 1) === value.length - 1;}
const CONCATENATION_GLUE = /^\s*\+\s*[^;'"`]{1,120}?\s*\+\s*$/;
const LITERAL_GLUE = /^\s*\+\s*$/;
const TRAILING_OPERAND = /^\s*\+/;
interface ComposedPath { value: string; line: number; start: number }
function glueSeparator(glue: string): string | null {
  if (CONCATENATION_GLUE.test(glue)) return '{}';
  return LITERAL_GLUE.test(glue) ? '' : null;}
/** The paths a file's literals actually name, in source order: neighbours joined by a glue compose one path judged at its first fragment's line, a run ending at a segment boundary takes the operand it is joined onwards to as one more `{}` (`'/users/' + id` is `/users/{}`), and nothing is prepended to a run or appended to a fragment that stops inside a segment. */
function composedPaths(stripped: string, literals: readonly Literal[]): ComposedPath[] {
  const composed: ComposedPath[] = [];
  let runStart = 0;
  let separators: string[] = [];
  for (let index = 1; index <= literals.length; index += 1) {
    const previous = literals[index - 1];
    const next: Literal | undefined = literals[index];
    const separator = next === undefined ? null : glueSeparator(stripped.slice(previous.end, next.start));
    if (separator !== null) {
      separators.push(separator);
      continue;}
    const fragments = literals.slice(runStart, index);
    const joined = fragments.map((fragment, position) => (position === 0 ? fragment.value : `${separators[position - 1]}${fragment.value}`))
      .join('');
    const trailing = previous.value.endsWith('/') && TRAILING_OPERAND.test(stripped.slice(previous.end));
    composed.push({ value: trailing ? `${joined}{}` : joined, line: fragments[0].line, start: fragments[0].start });
    runStart = index;
    separators = [];
  }
  return composed;
}
const INLINE_API_URL = /\$\{\s*apiUrl\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\}/g;
function resolveInlineApiUrl(value: string): string {
  return value.replace(INLINE_API_URL, (_match: string, _quote: string, inner: string): string => inner);
}
/** The path a literal must be compared as, or `null` when it names none: `/`-absolute as written, an `apiUrl(...)` argument whatever it looks like, a value carrying the apiPath text, or a relative value holding a `/` whose first segment a declared family names (`'clients/' + id` is `/clients/{}`); a map-key name and a bare `${…}` name no path. */
function pathCandidate(raw: string, argument: boolean, apiPathText: string, families: ReadonlySet<string>): string | null {
  if (raw.startsWith('/')) return raw;
  if (argument) return `/${raw}`;
  if (raw.includes(apiPathText)) return raw;
  if (raw.startsWith('$')) return null;
  return raw.includes('/') && families.has(raw.split('/')[0]) ? `/${raw}` : null;
}
function endpointFamilies(paths: string[]): Set<string> {
  const families = new Set<string>();
  for (const path of paths) {
    const segment = canonicalPath(path).split('/')[1] ?? '';
    if (segment !== '' && segment !== '{}') families.add(segment);
  }
  return families;
}
const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9.+-]*$/;
/** True for a path-like literal deliberately not judged — a filesystem or URL path or a fragment of one: it holds a `/` and no whitespace, none of `: ? * =`, is no MIME type and starts with none of `.` `@` `#`; such a literal is noted where it is skipped (AAP 0.14.1). */
function isPathLike(value: string): boolean {
  return value.includes('/') && !/[\s:?*=]/.test(value) && !MIME_TYPE.test(value) && !/^[.@#]/.test(value);
}
const ENDPOINTS_USAGE: CliUsage = {
  name: 'check:endpoints',
  summary: 'Fails on any Fineract URL under web-ng/src that endpoint-allowlist.json does not declare, and on any public demo host in the tree.',
  effects: [
    'scans web-ng/src, web-ng/e2e and web-ng/tools and fails on a Fineract URL the four parity data files do not declare',
    'fails on a public demo Fineract host in code or in a comment (Rule 2)',
    'writes nothing: the gate only reads the tree and the data files under web-ng/tools/parity',
  ],
  environment: [
    'none — the gate reads the four data files under web-ng/tools/parity and no environment variable',
  ],
  examples: [
    'npm run check:endpoints',
  ],
};
const intent = resolveCliIntent(ENDPOINTS_USAGE, process.argv.slice(2));
if (intent.kind === 'handled') {
  process.exitCode = intent.exitCode;
}
if (intent.kind === 'run') await runCheck('check:endpoints', async (): Promise<CheckOutcome> => {
  const violations: Violation[] = [];
  const notes: string[] = [LEGACY_NOTE];
  const fail = (rule: string, file: string, line: number, message: string): void => { violations.push(violation(rule, file, line, message)); };
  let appFiles = 0;
  let harnessFiles = 0;
  let literals = 0;
  let appEntries = 0;
  let harnessEntries = 0;
  const appPaths = new Set<string>();
  const harnessPaths = new Set<string>();
  const outcome = (): CheckOutcome =>
    ({ check: 'check:endpoints', violations, notes, scanned: { appFiles, harnessFiles, literals, appEntries, appPaths: appPaths.size, harnessEntries, harnessPaths: harnessPaths.size } });
  const appList = await loadList(APP_FILE, 'endpoint-allowlist', violations);
  const harnessList = await loadList(HARNESS_FILE, 'harness-allowlist', violations);
  const routeList = await loadList(ROUTES_FILE, 'endpoint-allowlist', violations);
  const appRows = appList === null ? [] : asRows(appList, 'entries');
  const harnessRows = harnessList === null ? [] : asRows(harnessList, 'entries');
  appEntries = appRows.length;
  harnessEntries = harnessRows.length;
  if (appList === null || harnessList === null || routeList === null) return outcome();
  const apiPathText = asString(asRecord(appList['header']), 'apiPath');
  if (apiPathText === null) {
    fail('endpoint-allowlist', dataFile(APP_FILE), 0, 'header.apiPath is missing, so no literal can be resolved against the list');
    return outcome();
  }
  const apiPath = canonicalPath(apiPathText);
  for (const path of column(appRows, 'path')) appPaths.add(canonicalPath(apiPathText + path));
  const families = endpointFamilies(column(appRows, 'path'));
  const harnessApiPathText = asString(asRecord(harnessList['header']), 'apiPath') ?? apiPathText;
  // Spring management endpoints sit beside the API context rather than under apiPath, so server-root entries are kept in a namespace of their own.
  const serverRootPaths = new Set<string>();
  for (const entry of harnessRows) {
    const prefix = asString(entry, 'prefix');
    const path = asString(entry, 'path');
    if (path === null || (prefix !== 'apiPath' && prefix !== 'serverRoot')) {
      fail('harness-allowlist', dataFile(HARNESS_FILE), 0, `entry needs a string path and prefix apiPath or serverRoot: ${String(prefix)} ${String(path)}`);
      continue;
    }
    const declared = canonicalPath(prefix === 'apiPath' ? harnessApiPathText + path : path);
    harnessPaths.add(declared);
    if (prefix === 'serverRoot') serverRootPaths.add(declared);
  }
  for (const path of harnessPaths) {
    if (appPaths.has(path)) fail('allowlist-overlap', dataFile(HARNESS_FILE), 0, `${path} is declared harness-only yet also appears in ${dataFile(APP_FILE)}`);
  }
  const navigation = navigationPatterns(column(asRows(routeList, 'routes'), 'path'));
  const roots: { directory: string; rule: string; application: boolean }[] = [
    { directory: join(webNgRoot, 'src'), rule: 'endpoint-allowlist', application: true },
    { directory: join(webNgRoot, 'e2e'), rule: 'harness-allowlist', application: false },
    { directory: join(webNgRoot, 'tools'), rule: 'harness-allowlist', application: false },
  ];
  for (const root of roots) {
    const shown = relative(repoRoot, root.directory).split(sep).join('/');
    let files: string[];
    try {
      files = await walk(root.directory, { extensions: TEXT_SUFFIXES, skip: SELF_SKIPPED });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).split(root.directory).join(shown);
      fail(root.rule, shown, 0, reason);
      continue;
    }
    if (files.length === 0) {
      fail(root.rule, shown, 0, 'holds no scannable text file, so nothing under it could be checked');
      continue;
    }
    for (const file of files) {
      const display = relative(repoRoot, file).split(sep).join('/');
      const text = await readText(file);
      if (root.application) appFiles += 1;
      else harnessFiles += 1;
      // Rule 2 forbids a demo host in code and in comments alike, so the file is read before comments go.
      for (const [index, line] of text.split('\n').entries()) {
        if (DEMO_HOST.test(line)) fail('demo-host', display, index + 1, 'a public demo Fineract host is forbidden: every environment calls the Blitzy Fineract server named by FINERACT_BASE_URL');
      }
      if (!SOURCE_SUFFIXES.some((suffix) => file.endsWith(suffix))) continue;
      const stripped = stripComments(text);
      const callArguments = new Set([...stripped.matchAll(API_URL_CALL)].map((match) => (match.index ?? 0) + match[0].length));
      for (const path of composedPaths(stripped, findUrlLiterals(text))) {
        const argument = callArguments.has(path.start);
        const raw = resolveInlineApiUrl(path.value);
        const candidate = pathCandidate(raw, argument, apiPathText, families);
        // A path-like literal this gate will not judge is noted where it is skipped, never tolerated in silence (AAP 0.14.1).
        if (candidate === null) {
          if (isPathLike(raw)) notes.push(`${display}:${path.line} — path-like literal \`${raw}\` names no path this gate can resolve (not absolute, not an apiUrl() argument, and its first segment is not a declared endpoint family), so it is skipped visibly rather than silently`);
          continue;}
        if (isStaticAsset(candidate)) {
          if (isPathLike(raw)) notes.push(`${display}:${path.line} — path-like literal \`${raw}\` is an in-place static asset rather than a Fineract endpoint, so it is skipped`);
          continue;}
        literals += 1;
        const canonical = canonicalPath(candidate);
        // The apiPath constant is configuration and navigation is not an endpoint; an apiUrl() argument skips the navigation test because the call site, not the string, tells the two apart.
        if (canonical === apiPath || (!argument && !canonical.startsWith(`${apiPath}/`) && isNavigationPath(navigation, canonical))) continue;
        // A server-root harness path sits outside apiPath and is matched in its own namespace before any prefixing, and only the harness and the checks may name one.
        if (!root.application && raw.startsWith('/') && serverRootPaths.has(canonical)) continue;
        const endpoint = canonical.startsWith(`${apiPath}/`) ? canonical : canonicalPath(apiPath + canonical);
        if (appPaths.has(endpoint) || (!root.application && harnessPaths.has(endpoint))) continue;
        // A URL builder re-renders a path it is handed by id role (AAP 0.10.2), so only its static head is judgeable; only the harness and the checks get this, because AAP 0.14.1 requires no silent tolerance of an unlisted endpoint under src/.
        const head = builderHead(candidate);
        if (!root.application && head !== null && (head === apiPath || appPaths.has(head) || harnessPaths.has(head) || isWholePathLiteral(candidate))) {
          notes.push(`${display}:${path.line} — URL builder \`${raw}\` re-renders a path it is given and names no single endpoint, so it is accepted rather than judged as a concrete path (its static head resolves to ${head})`);
          continue;
        }
        fail(root.rule, display, path.line, `${endpoint} is not declared in ${root.application ? dataFile(APP_FILE) : `${dataFile(APP_FILE)} or ${dataFile(HARNESS_FILE)}`}`);}}}
  return outcome();});
