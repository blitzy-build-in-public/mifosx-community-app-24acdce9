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
// A literal is resolved into the one path it names before it is judged, and the resolved path is what both lists
// are compared against. A `+`-joined concatenation is stitched into a single composed path, each pair of literals
// joined by the separator its own glue calls for: an operand between them (`+ <expression> +`) stands for `{}`, so
// `'/loans/' + id + '/template'` reads as `/loans/{}/template`, while a bare `+` joins the literals themselves, so
// `'/loans/' + '/template'` reads as `/loans//template`, which canonicalises to `/loans/template`. Either way a
// declared endpoint is never judged as its tail alone, and check-templates.ts stitches the same shapes. A run that
// ends at a segment boundary keeps the operand it is joined onwards to, so `'/users/' + id` is `/users/{}` and
// `'/datatables/' + table + '/' + id` is `/datatables/{}/{}`, not the segment short of them. A `${apiUrl('…')}`
// interpolation is replaced by the path it names, so a path composed inside one template literal is judged as the
// path it builds. A relative literal that holds a `/` and begins with a segment the app allowlist declares is judged
// as the absolute path it means — `'clients/' + id` is `/clients/{}` — while a bare name such as a map key stays out
// of the scan.
//
// The rest is namespace. The apiPath constant and the in-scope routes are configuration and navigation rather than
// endpoints; a `serverRoot` harness entry is absolute and outside apiPath, so it is matched before any prefixing and
// only under `e2e/` and `tools/`; navigation is matched segment by segment, a route's `{}` segment standing for any
// single value; and a template literal that re-renders a path it is handed — a URL builder — is accepted with a note
// naming its file and line, because it names no single endpoint for either list to hold.
//
// Nothing is skipped in silence (AAP 0.14.1). A path-like literal that is still deliberately passed over — one that
// resolves to no path, or one that is a static asset served in place — is noted with its file, line, value and
// reason; a scan root that exists yet yields no scannable file fails exactly as a missing root does, because the
// least-checkable tree must not be the one that passes; and the coverage line reports the declared rows of both
// lists beside the distinct canonical paths those rows collapse to, so declared and compared are never confused.
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from './lib/cli.js';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import type { Literal } from './lib/source-scan.js';
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

/** Text between two neighbouring quoted literals that joins them into one path: `+ <expression> +`. */
const CONCATENATION_GLUE = /^\s*\+\s*[^;'"`]{1,120}?\s*\+\s*$/;

/** Text between two neighbouring quoted literals joined by the operator alone: nothing but `+` and whitespace. */
const LITERAL_GLUE = /^\s*\+\s*$/;

/** Text after a literal that opens the operand it is joined to: whitespace, a newline included, then the operator. */
const TRAILING_OPERAND = /^\s*\+/;

/** One path a source file names: its fragments joined with their glues, and the line of its first fragment. */
interface ComposedPath { value: string; line: number; start: number }

/**
 * The separator that stands in for the text joining two neighbouring literals of one run, or `null` when that text
 * joins nothing and the run ends there. `+ <expression> +` glues through an operand the run has no literal for, so
 * the composed path carries a `{}` in its place. A bare `+` glues through nothing at all, so the two literals are
 * joined with the empty string and the composed path is the one they spell out together:
 * `'/loans/' + '/template'` is `/loans//template`, which `canonicalPath` collapses to `/loans/template`. Judging
 * that pair as two paths would report the declared endpoint `/loans/{id}/template` as its undeclared tail `/template`.
 *
 * @param glue The text between one literal's end and the next literal's start.
 */
function glueSeparator(glue: string): string | null {
  if (CONCATENATION_GLUE.test(glue)) return '{}';
  return LITERAL_GLUE.test(glue) ? '' : null;
}

/**
 * The paths a file's literals actually name, in source order. Neighbouring literals joined by a glue are one composed
 * path, judged once at its first fragment's line: a literal glued through an operand (`+ <expression> +`) is joined
 * with `{}`, so `'/loans/' + id + '/template'` reads as `/loans/{}/template`, and a pair glued by the operator alone
 * (`+`) is joined with the empty string, so `'/loans/' + '/template'` reads as `/loans//template` — the path the two
 * literals build between them. Either way a declared endpoint is never reported as its tail alone, and this gate
 * agrees with check-templates.ts, which stitches the same shapes. A literal with no glue of its own is a run of one
 * and is judged exactly as before. The glue's `\s` spans newlines, so a concatenation written over several lines is
 * composed too.
 *
 * A run that ends at a segment boundary and is joined onwards to an operand the run has no literal for takes that
 * operand as its next segment, so one `{}` is appended: `apiUrl('/users/' + id)` is `/users/{}` and
 * `apiUrl('/datatables/' + table + '/' + id)` is `/datatables/{}/{}`, judged in full rather than one segment short.
 * Two boundaries hold that rule. Nothing is prepended for an operand in front of a run, because the literal after it
 * already carries its own `{}` — `apiPath + '/clients'` stays `/clients`. And nothing is appended when the last
 * fragment stops inside a segment, because the operand there continues that segment rather than starting a new one:
 * `'/clients' + suffix`, `'/clients/' + id + '?template=true'` and
 * `'/loans/' + id + '/transactions?command=' + command` all read as they did before.
 *
 * @param stripped Comment-free text the literals were found in: every offset, and every slice, is in its coordinates.
 * @param literals The file's quoted literals, in source order.
 */
function composedPaths(stripped: string, literals: readonly Literal[]): ComposedPath[] {
  const composed: ComposedPath[] = [];
  let runStart = 0;
  // The separator of each glue already absorbed into the open run, in source order: one per fragment after the first.
  let separators: string[] = [];
  for (let index = 1; index <= literals.length; index += 1) {
    const previous = literals[index - 1];
    const next: Literal | undefined = literals[index];
    const separator = next === undefined ? null : glueSeparator(stripped.slice(previous.end, next.start));
    if (separator !== null) {
      separators.push(separator);
      continue;
    }
    const fragments = literals.slice(runStart, index);
    const joined = fragments
      .map((fragment, position) => (position === 0 ? fragment.value : `${separators[position - 1]}${fragment.value}`))
      .join('');
    const trailing = previous.value.endsWith('/') && TRAILING_OPERAND.test(stripped.slice(previous.end));
    composed.push({ value: trailing ? `${joined}{}` : joined, line: fragments[0].line, start: fragments[0].start });
    runStart = index;
    separators = [];
  }
  return composed;
}

/** An interpolation whose entire content is an `apiUrl('…')` or `apiUrl("…")` call; group 2 is the inner path. */
const INLINE_API_URL = /\$\{\s*apiUrl\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\}/g;

/**
 * A literal with every `${apiUrl('…')}` interpolation replaced by the path that call names, so a path composed
 * inside one template literal — `` `${apiUrl('/loans')}/${id}/unlisted` `` — is judged as the path it builds rather
 * than dropped because the literal itself starts with `${`. Every other interpolation is left alone: `canonicalPath`
 * already reduces a whole `${…}` segment to `{}`.
 *
 * @param value A literal's value, after any `+`-joined neighbours have been composed into it.
 */
function resolveInlineApiUrl(value: string): string {
  return value.replace(INLINE_API_URL, (_match: string, _quote: string, inner: string): string => inner);
}

/**
 * The path a literal must be compared as, or `null` when it names none. A value starting with `/` is already
 * absolute; an `apiUrl(...)` argument is a call whatever it looks like; a value carrying the apiPath text holds its
 * own prefix; and a relative value that holds a `/` and whose first segment the app allowlist declares is a
 * family-relative call — `'clients/' + id` names `/clients/{}` — so it is judged like any other path instead of
 * vanishing. The `/` is what separates a relative path from a bare name: a map key such as the role name `users`
 * names no path, while `/users/{id}` stays the only declared form of that family. A value starting with `${` is an
 * interpolation with no static head and no path of its own, and is left to the URL-builder rule.
 *
 * @param raw A literal's value, inline `apiUrl(...)` interpolations already resolved.
 * @param argument True when the value's first fragment is the argument of an `apiUrl(...)` call.
 * @param apiPathText The apiPath text endpoint-allowlist.json declares.
 * @param families First path segment of every app allowlist row, from {@link endpointFamilies}.
 */
function pathCandidate(raw: string, argument: boolean, apiPathText: string, families: ReadonlySet<string>): string | null {
  if (raw.startsWith('/')) return raw;
  if (argument) return `/${raw}`;
  if (raw.includes(apiPathText)) return raw;
  if (raw.startsWith('$')) return null;
  return raw.includes('/') && families.has(raw.split('/')[0]) ? `/${raw}` : null;
}

/**
 * The first path segment of every app allowlist row: the endpoint families the application declares. `'/loans/{id}'
 * contributes `loans`, and a row whose first segment is only a placeholder contributes nothing.
 *
 * @param paths The `path` column of endpoint-allowlist.json, each relative to its apiPath.
 */
function endpointFamilies(paths: string[]): Set<string> {
  const families = new Set<string>();
  for (const path of paths) {
    const segment = canonicalPath(path).split('/')[1] ?? '';
    if (segment !== '' && segment !== '{}') families.add(segment);
  }
  return families;
}

/**
 * A content type is a registered media-type root followed by a subtype, and never a path: `text/html`,
 * `application/json`, `application/x-www-form-urlencoded`. Only the nine top-level media types IANA registers
 * identify a content type, so the root is what settles the question: `assets/config.json` and
 * `images/avatar.png` are in-place asset paths, not MIME types, and stay path-like so their skip is noted.
 */
const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9.+-]*$/;

/**
 * True for a literal that reads as a path though it is deliberately not judged — a filesystem path, a URL path, a
 * fragment of one. It holds a `/` and no whitespace, holds none of `: ? * =`, is not a MIME type, and does not start
 * with `.` `@` or `#` (a relative file, a decorator or an anchor). Such a literal is noted where it is skipped, so a
 * path this gate cannot resolve is never tolerated in silence (AAP 0.14.1).
 */
function isPathLike(value: string): boolean {
  return value.includes('/') && !/[\s:?*=]/.test(value) && !MIME_TYPE.test(value) && !/^[.@#]/.test(value);
}

/**
 * What `--help` prints (finding 406f-F02): what the gate proves, that it writes nothing, the fact that
 * it reads no environment variable, and how it is run.
 */
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

// A usage request is answered before the gate body runs, so `--help` reads no file and proves nothing
// (finding 406f-F02). The code goes on process.exitCode, never through process.exit(), so a piped
// summary line is never lost.
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
  // Declared rows and the distinct canonical paths they collapse to are reported as separate counts: `appEntries`
  // and `harnessEntries` are what each data file declares, `appPaths` and `harnessPaths` what the literals were
  // compared against, so the coverage line can never pass one off as the other.
  let appEntries = 0;
  let harnessEntries = 0;
  const appPaths = new Set<string>();
  const harnessPaths = new Set<string>();
  const outcome = (): CheckOutcome =>
    ({ check: 'check:endpoints', violations, notes, scanned: { appFiles, harnessFiles, literals, appEntries, appPaths: appPaths.size, harnessEntries, harnessPaths: harnessPaths.size } });

  const appList = await loadList(APP_FILE, 'endpoint-allowlist', violations);
  const harnessList = await loadList(HARNESS_FILE, 'harness-allowlist', violations);
  const routeList = await loadList(ROUTES_FILE, 'endpoint-allowlist', violations);
  // A list that loaded declares its rows even when the run then stops, so a failing run still reports what it knew.
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
  // The families the app allowlist declares: a relative literal starting with one names a path of that family.
  const families = endpointFamilies(column(appRows, 'path'));
  const harnessApiPathText = asString(asRecord(harnessList['header']), 'apiPath') ?? apiPathText;
  // Spring management endpoints sit beside the API context rather than under apiPath, so the server-root entries
  // are also kept in a namespace of their own: judging them needs the namespace, not an apiPath-prefixed path.
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
    // A root that exists but yields nothing now fails like a root that is gone: a tree the gate can read nothing
    // from is the least-checkable tree there is, so reporting it as a note would pass exactly the case that most
    // needs a verdict. The repository-relative root names it, and nothing under it can be claimed as scanned.
    if (files.length === 0) {
      fail(root.rule, shown, 0, 'holds no scannable text file, so nothing under it could be checked');
      continue;
    }
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
      for (const path of composedPaths(stripped, findUrlLiterals(text))) {
        const argument = callArguments.has(path.start);
        const raw = resolveInlineApiUrl(path.value);
        // An `apiUrl(...)` argument is a call whatever it looks like; anything else must read as a path to count.
        const candidate = pathCandidate(raw, argument, apiPathText, families);
        // A path-like literal this gate will not judge is noted where it is skipped: one that reads as a path yet
        // resolves to nothing, and one that is a static asset served in place. Neither is tolerated in silence
        // (AAP 0.14.1), and the note names the file, the line, the literal and the reason.
        if (candidate === null) {
          if (isPathLike(raw)) notes.push(`${display}:${path.line} — path-like literal \`${raw}\` names no path this gate can resolve (not absolute, not an apiUrl() argument, and its first segment is not a declared endpoint family), so it is skipped visibly rather than silently`);
          continue;
        }
        if (isStaticAsset(candidate)) {
          if (isPathLike(raw)) notes.push(`${display}:${path.line} — path-like literal \`${raw}\` is an in-place static asset rather than a Fineract endpoint, so it is skipped`);
          continue;
        }
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
          notes.push(`${display}:${path.line} — URL builder \`${raw}\` re-renders a path it is given and names no single endpoint, so it is accepted rather than judged as a concrete path (its static head resolves to ${head})`);
          continue;
        }
        fail(root.rule, display, path.line, `${endpoint} is not declared in ${root.application ? dataFile(APP_FILE) : `${dataFile(APP_FILE)} or ${dataFile(HARNESS_FILE)}`}`);
      }
    }
  }
  return outcome();
});
