/// <reference types="node" />
// npm run check:endpoints — AAP 0.10.4 row 1, criterion 5: every Fineract URL under web-ng/src must be declared in
// endpoint-allowlist.json (Rule 1 clause 2) and no public demo host may appear anywhere (Rule 2).
//
// The seven URL-owning files of AAP 0.8.2 — the same seven web-ng/eslint.config.js exempts from banning HttpClient —
// are core/auth/auth.service.ts, core/http/fineract.interceptor.ts, core/api/search.service.ts,
// core/api/datatable-gate.service.ts, features/clients/client.service.ts, features/loans/loan.service.ts and
// features/savings/savings.service.ts. The scan is tree-wide, so that list documents the architecture and never
// narrows what is checked. Seven self-referential paths are skipped: this file, check-templates.ts, check-wiring.ts
// and the four JSON data files. Membership is method-agnostic and path-only — query parameters and `?command=` are
// judged by the parity comparison (AAP 0.10.2), never here.
//
// A literal is resolved in the namespace it belongs to. The apiPath constant and the in-scope routes are
// configuration and navigation rather than endpoints; a `serverRoot` harness entry is absolute and outside apiPath,
// so it is matched before any prefixing and only under `e2e/` and `tools/`; navigation is matched segment by
// segment, a route's `{}` segment standing for any single value; and a template literal that re-renders a path it
// is handed — a URL builder — is accepted with a note naming its file and line, because it names no single endpoint
// for either list to hold.
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import { canonicalPath, findUrlLiterals, isStaticAsset, readText, stripComments, walk } from './lib/source-scan.js';

/** `web-ng/`: the parent of every scan root, resolved from this file's URL and never from `process.cwd()`. */
const webNgRoot: string = fileURLToPath(new URL('../../', import.meta.url));
/** Repository root, so every reported path is repo-relative and identical on every machine. */
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));

const APP_FILE = 'endpoint-allowlist.json';
const HARNESS_FILE = 'harness-allowlist.json';
const ROUTES_FILE = 'in-scope-routes.json';
/** Repo-relative path of one parity data file: the name every finding about a list carries. */
const dataFile = (name: string): string => `web-ng/tools/parity/${name}`;
/** Files a URL can be written in; the demo-host gate also reads templates, configuration and scripts. */
const TEXT_SUFFIXES: readonly string[] = ['.ts', '.js', '.mjs', '.cjs', '.html', '.json', '.scss', '.css', '.sh', '.yml', '.yaml'];
/** Files whose quoted literals are scanned for endpoint paths. */
const SOURCE_SUFFIXES: readonly string[] = ['.ts', '.js'];
const SELF_SKIPPED: readonly string[] = ['check-endpoints.ts', 'check-templates.ts', 'check-wiring.ts', 'endpoint-allowlist.json', 'harness-allowlist.json', 'in-scope-routes.json', 'scope-allowlist.json'];
// Rule 2 names both hosts outright; the escaped dots keep this file's own source from matching its pattern.
const DEMO_HOST = /demo\.(?:mifos\.io|fineract\.dev)/;
const API_URL_CALL = /\bapiUrl\s*\(\s*(?=['"`])/g;
const LEGACY_NOTE = 'legacy tree app/ absent from this checkout: the app allowlist is transcribed from AAP 0.7.3, not generated from app/scripts/services/ResourceFactoryProvider.js';

/** A JSON object, the only shape a data file may present; anything else is a load failure. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** A string field of an object, or `null` when it is absent or holds another type. */
const asString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record === null ? undefined : record[key];
  return typeof value === 'string' ? value : null;
};

/** The object rows of an array field; elements of another type are dropped rather than trusted. */
const asRows = (record: Record<string, unknown>, key: string): Record<string, unknown>[] => {
  const value = record[key];
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null) : [];
};

/** The string values of one field across rows, in file order. */
const column = (rows: Record<string, unknown>[], key: string): string[] =>
  rows.map((row) => asString(row, key)).filter((value): value is string => value !== null);

/** Parses one data file; a list that cannot be loaded is a violation, because it cannot then be enforced. */
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

/**
 * Canonical segment patterns of the in-scope routes: `canonicalPath` reduces every `:param` segment to `{}`, so
 * `loanaccount/:id/:action` becomes `['loanaccount', '{}', '{}']` and the `''` route becomes `[]`.
 */
function navigationPatterns(routes: string[]): string[][] {
  return routes.map((route) => canonicalPath(`/${route}`).split('/').filter((segment) => segment !== ''));
}

/**
 * True when `path` is an in-scope route or a segment prefix of one, compared segment by segment: a `{}` pattern
 * segment stands for any single value, so the concrete navigation `/loanaccount/{}/repayment` reaches the
 * parameterised route `loanaccount/:id/:action` (AAP 0.8.2 declares those action routes for navigation).
 *
 * @param patterns Canonical route patterns, from {@link navigationPatterns}.
 * @param path Canonical path of the literal being judged.
 */
function isNavigationPath(patterns: string[][], path: string): boolean {
  const segments = canonicalPath(path).split('/').filter((segment) => segment !== '');
  return patterns.some((pattern) => segments.length <= pattern.length
    && segments.every((segment, position) => pattern[position] === '{}' || pattern[position] === segment));
}

/** Opening of a `${…}` interpolation inside a template literal; the only form this scan can recognise. */
const INTERPOLATION = '${';

/**
 * Offset of the `}` closing the interpolation that opens at `start`, or `-1` when it never closes. Nested braces
 * are counted rather than searched for, so `${row[`${key}`]}` closes at its own last brace.
 */
function interpolationEnd(value: string, start: number): number {
  let depth = 0;
  for (let at = start + 1; at < value.length; at += 1) {
    const char = value.charAt(at);
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/**
 * The canonical path a URL builder's static head names, or `null` when the literal holds no interpolation. A
 * builder such as `` `${apiPath}/clients/${clientId}` `` re-renders a path it is handed rather than naming one
 * endpoint (AAP 0.10.2 templates ids by role), so only the text before the first `${…}` can be judged.
 */
function builderHead(value: string): string | null {
  const at = value.indexOf(INTERPOLATION);
  return at < 0 ? null : canonicalPath(value.slice(0, at));
}

/**
 * True when a literal holds its whole path inside one interpolation — a `/` followed by a single `${…}` that
 * runs to the end, the shape a normaliser that re-renders an observed pathname returns as
 * `` `/${templated.join('/')}` ``. Nothing concrete is static, so no list entry could ever be compared with it.
 */
function isWholePathLiteral(value: string): boolean {
  return value.startsWith('/') && value.indexOf(INTERPOLATION) === 1 && interpolationEnd(value, 1) === value.length - 1;
}

/** Offset of every line start, so a literal's reported line and column turn back into a source offset. */
function lineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

await runCheck('check:endpoints', async (): Promise<CheckOutcome> => {
  const violations: Violation[] = [];
  const notes: string[] = [LEGACY_NOTE];
  const fail = (rule: string, file: string, line: number, message: string): void => { violations.push(violation(rule, file, line, message)); };
  let appFiles = 0;
  let harnessFiles = 0;
  let literals = 0;
  const outcome = (appEntries: number, harnessEntries: number): CheckOutcome =>
    ({ check: 'check:endpoints', violations, notes, scanned: { appFiles, harnessFiles, literals, appEntries, harnessEntries } });

  const appList = await loadList(APP_FILE, 'endpoint-allowlist', violations);
  const harnessList = await loadList(HARNESS_FILE, 'harness-allowlist', violations);
  const routeList = await loadList(ROUTES_FILE, 'endpoint-allowlist', violations);
  if (appList === null || harnessList === null || routeList === null) return outcome(0, 0);

  const apiPathText = asString(asRecord(appList['header']), 'apiPath');
  if (apiPathText === null) {
    fail('endpoint-allowlist', dataFile(APP_FILE), 0, 'header.apiPath is missing, so no literal can be resolved against the list');
    return outcome(0, 0);
  }
  const apiPath = canonicalPath(apiPathText);
  const appPaths = new Set(column(asRows(appList, 'entries'), 'path').map((path) => canonicalPath(apiPathText + path)));
  const harnessApiPathText = asString(asRecord(harnessList['header']), 'apiPath') ?? apiPathText;
  const harnessPaths = new Set<string>();
  // Spring management endpoints sit beside the API context rather than under apiPath, so the server-root entries
  // are also kept in a namespace of their own: judging them needs the namespace, not an apiPath-prefixed path.
  const serverRootPaths = new Set<string>();
  for (const entry of asRows(harnessList, 'entries')) {
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

  // The application tree, then the harness and the checks: a URL there may be in either list (AAP 0.8.2).
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
      // A root that is gone cannot be claimed as scanned, so it fails rather than passing on an empty list. walk()
      // names the absolute path, which is rewritten to the repo-relative one so the finding stays machine-independent.
      const reason = (error instanceof Error ? error.message : String(error)).split(root.directory).join(shown);
      fail(root.rule, shown, 0, reason);
      continue;
    }
    // A root that exists but yields nothing is a note, never a violation: the counts are what prove the gap.
    if (files.length === 0) notes.push(`${shown} holds no scannable text file, so nothing under it could be checked`);
    for (const file of files) {
      const display = relative(repoRoot, file).split(sep).join('/');
      const text = await readText(file);
      if (root.application) appFiles += 1;
      else harnessFiles += 1;
      // Rule 2 forbids a demo host in code and in comments alike, so this reads the file before comments go.
      for (const [index, line] of text.split('\n').entries()) {
        if (DEMO_HOST.test(line)) fail('demo-host', display, index + 1, 'a public demo Fineract host is forbidden: every environment calls the Blitzy Fineract server named by FINERACT_BASE_URL');
      }
      if (!SOURCE_SUFFIXES.some((suffix) => file.endsWith(suffix))) continue;
      const stripped = stripComments(text);
      const callArguments = new Set([...stripped.matchAll(API_URL_CALL)].map((match) => (match.index ?? 0) + match[0].length));
      const starts = lineStarts(stripped);
      for (const literal of findUrlLiterals(text)) {
        const argument = callArguments.has((starts[literal.line - 1] ?? 0) + literal.column - 1);
        const raw = literal.value;
        // An `apiUrl(...)` argument is a call whatever it looks like; anything else must read as a path to count.
        const candidate = raw.startsWith('/') ? raw : argument ? `/${raw}` : raw.includes(apiPathText) ? raw : null;
        if (candidate === null || isStaticAsset(candidate)) continue;
        literals += 1;
        const canonical = canonicalPath(candidate);
        // The apiPath constant is configuration, not a call, and navigation is not an endpoint. An `apiUrl(...)`
        // argument skips the navigation test on purpose: `/clients` and `/search` are both a route and an endpoint,
        // and the call site, not the string, is what tells the two apart.
        if (canonical === apiPath || (!argument && !canonical.startsWith(`${apiPath}/`) && isNavigationPath(navigation, canonical))) continue;
        // A server-root harness path is absolute and sits outside apiPath, so it is matched in its own namespace
        // before any prefixing. Only the harness and the checks may name one: a literal under src/ has to be an
        // application endpoint, so a server-root path never excuses it.
        if (!root.application && raw.startsWith('/') && serverRootPaths.has(canonical)) continue;
        const endpoint = canonical.startsWith(`${apiPath}/`) ? canonical : canonicalPath(apiPath + canonical);
        if (appPaths.has(endpoint) || (!root.application && harnessPaths.has(endpoint))) continue;
        // A URL builder re-renders a path it is handed, by id role (AAP 0.10.2), so it names no single endpoint and
        // no list entry can hold it. Only its static head is judgeable: when that head resolves to the apiPath itself
        // or to a path a list declares — or when the whole path is the interpolation, leaving nothing static — the
        // literal is accepted with a note naming the file and line. A literal with static segments of its own is
        // still judged exactly as above, so interpolation is no exemption by itself.
        //
        // Only the harness and the checks get this: they re-render paths the legacy UI was driven to, which no list
        // could hold. An application literal must still name an endpoint the app allowlist declares, so under src/ a
        // builder stays a violation, exactly as AAP 0.14.1 requires ("no silent tolerance of an unlisted endpoint").
        const head = builderHead(candidate);
        if (!root.application && head !== null && (head === apiPath || appPaths.has(head) || harnessPaths.has(head) || isWholePathLiteral(candidate))) {
          notes.push(`${display}:${literal.line} — URL builder \`${raw}\` re-renders a path it is given and names no single endpoint, so it is accepted rather than judged as a concrete path (its static head resolves to ${head})`);
          continue;
        }
        fail(root.rule, display, literal.line, `${endpoint} is not declared in ${root.application ? dataFile(APP_FILE) : `${dataFile(APP_FILE)} or ${dataFile(HARNESS_FILE)}`}`);
      }
    }
  }
  return outcome(appPaths.size, harnessPaths.size);
});
