// npm run check:wiring — AAP 0.10.4 row 3, criteria 7 and 8 (Rule 1 clause 8, AAP 0.11.1, AAP 0.4.4, Rule 1 clause 9).
import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from './lib/cli.js';
import type { CheckOutcome, Violation } from './lib/report.js';
import { runCheck, violation } from './lib/report.js';
import type { RouteDecl } from './lib/source-scan.js';
import { findComponentClasses, findInjectableClasses, findRouteDeclarations, hasExpect, readText, stripComments, walk } from './lib/source-scan.js';

/** `web-ng/`: the parent of every scan root, resolved from this file's URL and never from `process.cwd()`. */
const webNgRoot: string = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'check:wiring';
const ROUTES_FILE = 'in-scope-routes.json';
const SCOPE_FILE = 'scope-allowlist.json';
const dataFile = (name: string): string => `web-ng/tools/parity/${name}`;
const APP_ROOT = join(webNgRoot, 'src', 'app');
const APP_ROOT_SHOWN = 'web-ng/src/app';
const APP_ROUTES_FILE = join(APP_ROOT, 'app.routes.ts');
const APP_ROUTES_SHOWN = 'web-ng/src/app/app.routes.ts';
/** Suffix of a route file, which is what `walk` keeps when the route tree is read. */
const ROUTE_SUFFIX = '.routes.ts';
const APP_SUFFIXES: readonly string[] = ['.ts', '.html'];
const SPEC_SUFFIXES: readonly string[] = ['.spec.ts', '.test.ts'];
/** The `testDir` the Playwright config sets, holding the workflow specs `npm run e2e` executes. */
const E2E_SPECS_ROOT = join(webNgRoot, 'e2e', 'specs');
const E2E_SPECS_SHOWN = 'web-ng/e2e/specs';
const TEXT_SUFFIXES: readonly string[] = ['.ts', '.html', '.json', '.sh', '.yml', '.yaml'];
const GENERATED_SKIP: readonly string[] = ['.captures', 'parity-report.json', 'parity-report.md'];
const SELF_SKIPPED = 'check-wiring.ts';
/** The two files this work may add at the repository root, beside everything `web-ng/**` holds (AAP 0.4.4 item 2). */
const ROOT_ADDITIONS: readonly string[] = ['Dockerfile.web-ng', 'docker-compose.web-ng.yml'];
const OUTSIDE_BOUNDARY = 'is outside the write boundary: the work may occupy web-ng/** and add only Dockerfile.web-ng, docker-compose.web-ng.yml and the root files scope-allowlist.json names (AAP 0.4.4 item 2, criterion 8)';

const DEAD_INJECTABLE = 'dead-injectable';
const DEAD_COMPONENT = 'dead-component';
const ROUTE_DRIFT = 'route-drift';
const SPEC_WITHOUT_EXPECT = 'spec-without-expect';
const CREDENTIAL_LITERAL = 'credential-literal';
const WRITE_BOUNDARY = 'write-boundary';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record === null ? undefined : record[key];
  return typeof value === 'string' ? value : null;
};

const asRows = (record: Record<string, unknown>, key: string): Record<string, unknown>[] => {
  const value = record[key];
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null) : [];
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const execFileAsync = promisify(execFile);
const GIT_OPTIONS: ExecFileOptionsWithStringEncoding = { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' };

interface Change { status: string; path: string }

const splitZ = (listing: string): string[] => listing.split('\0').filter((field: string): boolean => field.length > 0);

/** Reads a `git diff --name-status -z` listing: `STATUS\0path\0` pairs, the only shape `--no-renames` emits. */
const readChanges = (listing: string): Change[] => {
  const fields = splitZ(listing);
  const changes: Change[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    changes.push({ status: fields[at] ?? '', path: fields[at + 1] ?? '' });
  }
  return changes;
};

/** True when a repo-relative path lies inside `web-ng/`, the one tree this work may occupy (AAP 0.4.4 item 2). */
const isUnderWebNg = (shown: string): boolean => shown.startsWith('web-ng/');

async function git(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, GIT_OPTIONS);
  return stdout;
}

interface LoadedData { document: Record<string, unknown>; text: string }

async function loadData(name: string, rule: string, violations: Violation[]): Promise<LoadedData | null> {
  const location = new URL(`./${name}`, import.meta.url);
  try {
    const text: string = await readText(fileURLToPath(location));
    const parsed: unknown = JSON.parse(text);
    const document = asRecord(parsed);
    if (document === null) throw new Error('the file does not hold a JSON object');
    return { document, text };
  } catch (error) {
    const reason = describe(error).split(fileURLToPath(location)).join(dataFile(name));
    violations.push(violation(rule, dataFile(name), 0, `cannot be read, so the class it settles cannot be judged: ${reason}`));
    return null;
  }
}

function lineOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  return at < 0 ? 0 : text.slice(0, at).split('\n').length;
}

/** The three shapes `in-scope-routes.json` distinguishes; a composition point is none of them and is never listed. */
type RouteKind = 'component' | 'redirect' | 'wildcard';

interface DeclaredRoute { path: string; kind: RouteKind; redirectTo: string | null; file: string; line: number }

/** One route row of `in-scope-routes.json`, with the line it is written on. */
interface ListedRoute { path: string; kind: string; redirectTo: string | null; line: number }

/** One `path:` entry as its file writes it, with what decides whether it is a screen or a composition point. */
interface ParsedRoute { decl: RouteDecl; depth: number; children: boolean; loadChildren: boolean; loadComponent: boolean }

/** A `loadChildren` import: the route file it names, the prefix its own full path contributes, and where it is written. */
interface Mount { specifier: string; prefix: string; line: number }

/** Every `path:` key of a `Routes` array: the same literal `findRouteDeclarations` reads, kept with its offset. */
const PATH_KEY = /\bpath\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Brace depth at ascending offsets of one file, advancing a single pass through it: a route's `children` entries are written one `{` deeper than the route that owns them, which is what nests a declared path under its owning route. */
function depthReader(text: string): (offset: number) => number {
  let cursor = 0;
  let depth = 0;
  let quote = '';
  return (offset: number): number => {
    for (; cursor < offset; cursor += 1) {
      const char = text.charAt(cursor);
      if (quote !== '') {
        if (char === '\\') cursor += 1;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    return depth;
  };
}

/** Places each `path:` entry of one route file at its brace depth and reads what follows it up to the next entry: the text that tells a composition point (`children: [` or `loadChildren`) from a screen. */
function parseRoutes(stripped: string, decls: readonly RouteDecl[]): ParsedRoute[] {
  const keys = [...stripped.matchAll(PATH_KEY)];
  const depthAt = depthReader(stripped);
  const parsed: ParsedRoute[] = [];
  for (const [index, decl] of decls.entries()) {
    const key = keys[index];
    if (key === undefined) return parsed;
    const start = key.index;
    const body = stripped.slice(start + key[0].length, keys[index + 1]?.index ?? stripped.length);
    parsed.push({
      decl,
      depth: depthAt(start),
      children: /\bchildren\s*:\s*\[/.test(body),
      loadChildren: /\bloadChildren\b/.test(body),
      loadComponent: /\bloadComponent\b/.test(body),
    });
  }
  return parsed;
}

function kindOf(entry: ParsedRoute): RouteKind {
  if (entry.decl.redirectTo !== null) return 'redirect';
  return entry.loadComponent || entry.decl.path !== '**' ? 'component' : 'wildcard';
}

function enclosingPrefix(open: readonly { depth: number; prefix: string }[], base: string): string {
  return open.at(-1)?.prefix ?? base;
}

function composeRoutes(parsed: readonly ParsedRoute[], base: string, file: string): { routes: DeclaredRoute[]; mounts: Mount[] } {
  const routes: DeclaredRoute[] = [];
  const mounts: Mount[] = [];
  const open: { depth: number; prefix: string }[] = [];
  for (const entry of parsed) {
    while (open.length > 0 && (open.at(-1)?.depth ?? -1) >= entry.depth) open.pop();
    const prefix = enclosingPrefix(open, base);
    const full = [prefix, entry.decl.path].filter((part: string): boolean => part.length > 0).join('/');
    if (entry.loadChildren && entry.decl.lazySpecifier !== null) mounts.push({ specifier: entry.decl.lazySpecifier, prefix: full, line: entry.decl.line });
    if (entry.children || entry.loadChildren) {
      open.push({ depth: entry.depth, prefix: full });
      continue;
    }
    routes.push({ path: full, kind: kindOf(entry), redirectTo: entry.decl.redirectTo, file, line: entry.decl.line });
  }
  return { routes, mounts };
}

/** Absolute path of the route file a `loadChildren` specifier imports, resolved from the file that imports it. */
function resolveSpecifier(importingFile: string, specifier: string): string {
  const target = resolve(join(importingFile, '..'), specifier);
  return target.endsWith('.ts') ? target : `${target}.ts`;
}

interface RouteFileScan { file: string; shown: string; text: string }

function composeFile(scan: RouteFileScan, base: string, count: (declarations: number) => void): { routes: DeclaredRoute[]; mounts: Mount[] } {
  const decls: RouteDecl[] = findRouteDeclarations(scan.text);
  count(decls.length);
  const parsed = parseRoutes(stripComments(scan.text), decls);
  if (parsed.length !== decls.length) {
    // A `path:` declaration the composer could not place would drop a screen from the comparison in silence, so the run fails with the file named rather than passing on the routes it happened to place.
    throw new Error(`${scan.shown}: ${decls.length - parsed.length} of ${decls.length} path: declaration(s) could not be placed, so the route tree could not be composed`);
  }
  return composeRoutes(parsed, base, scan.shown);
}

const sameRoute = (path: string, kind: string, redirectTo: string | null, other: { path: string; kind: string; redirectTo: string | null }): boolean =>
  path === other.path && kind === other.kind && (redirectTo ?? '') === (other.redirectTo ?? '');

/** How a route's shape reads in a finding: its kind, and the redirect target when it has one. */
const shapeOf = (kind: string, redirectTo: string | null): string => (redirectTo === null ? `kind ${kind}` : `kind ${kind} redirecting to ${redirectTo}`);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when one file injects the class `name` names: through `inject(Name)`, which is how a functional interceptor and an initializer reach a dependency, or through a typed field or constructor parameter (`: Name`), which is how a class names the collaborator it injects. */
function injectsName(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return new RegExp(`\\binject\\s*\\(\\s*${escaped}\\s*[,)]`).test(text)
    || new RegExp(`:\\s*${escaped}\\s*[,;)}=]`).test(text);
}

/** True when a template renders the component `selector` names. An element selector is matched where the tag opens; an attribute selector (`[hasPermission]`, `input[type=date][appDateValue]`) is matched by every attribute. */
function usesSelector(templateText: string, selector: string): boolean {
  if (/^[A-Za-z][\w-]*$/.test(selector)) {
    return new RegExp(`<\\s*${escapeRegExp(selector)}(?=[\\s/>])`).test(templateText);
  }
  const required = [...selector.matchAll(/\[\s*([A-Za-z_$][\w$.-]*)/g)].map((match) => match[1] ?? '');
  if (required.length > 0) {
    return required.every((attribute) => new RegExp(`\\b${escapeRegExp(attribute)}\\b`).test(templateText));
  }
  const name = selector.replace(/^\./, '');
  return name !== '' && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(templateText);
}

/** A component a route renders: `component: Name`, which is how every screen in this tree is mounted. */
const ROUTED_COMPONENT = /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/g;
/** A component a route renders through a module: `loadComponent: () => import('./x').then((m) => m.Name)`. */
const LOADED_COMPONENT = /\bloadComponent\s*:[\s\S]*?\bimport\s*\(\s*['"][^'"]*['"]\s*\)[\s\S]*?=>\s*[A-Za-z_$][\w$]*\s*\.\s*([A-Za-z_$][\w$]*)/g;
/** A `loadComponent` key, counted so a shape the member capture cannot read is noted rather than passed over. */
const LOAD_COMPONENT_KEY = /\bloadComponent\b/g;
/** The root component `bootstrapApplication` renders, which no route and no template mentions. */
const BOOTSTRAPPED_ROOT = /\bbootstrapApplication\s*\(\s*([A-Za-z_$][\w$]*)/g;

/** A property or variable named `password`, `pass`, `secret` or `authenticationKey` assigned a quoted literal, which is the shape AAP 0.10.4 "Credential gate, defined once" forbids. */
const CREDENTIAL_KEYS: readonly string[] = ['password', 'pass', 'secret', 'authenticationKey'];
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(?:^|[^\\w$])(${CREDENTIAL_KEYS.join('|')})\\s*(?::|=(?!=))\\s*(['"\`])((?:\\\\.|(?!\\2)[^\\\\])*)\\2`,
  'g',
);
/** The login form's own `password` control name, written where the input is declared (AAP 0.10.4's exemption). */
const LOGIN_CONTROL = /\b(?:formControlName|name)\s*=\s*["']password["']/;
const LOGIN_FORM_FILE = /(?:^|\/)features\/auth\/login\/login\.component\.(?:ts|html)$/;
/** The tenant identifier, which AAP 0.10.4 leaves outside the credential gate by definition. */
const TENANT_LITERAL = /\b(?:tenantId|tenantIdentifier)\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function commentFree(file: string, text: string): string {
  if (file.endsWith('.ts')) return stripComments(text);
  if (file.endsWith('.html')) return text.replace(/<!--[\s\S]*?-->/g, (match: string): string => match.replace(/[^\n]/g, ' '));
  return text;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

interface ScannedFile { shown: string; text: string }

async function scanFiles(files: readonly string[]): Promise<ScannedFile[]> {
  return Promise.all(files.map(async (file: string) => ({
    shown: relative(repoRoot, file).split(sep).join('/'),
    text: await readText(file),
  })));
}

function countFiles<T extends ScannedFile>(files: T[], into: Set<string>): T[] {
  for (const file of files) into.add(file.shown);
  return files;
}

async function readRoot(root: string, extensions: readonly string[], rule: string, violations: Violation[], skip: readonly string[] = []): Promise<ScannedFile[]> {
  const shown = relative(repoRoot, root).split(sep).join('/');
  try {
    const files = await walk(root, { extensions, skip });
    if (files.length === 0) {
      violations.push(violation(rule, shown === '' ? '.' : shown, 0, 'holds no scannable file, so nothing under it could be checked'));
    }
    return await scanFiles(files);
  } catch (error) {
    violations.push(violation(rule, shown === '' ? '.' : shown, 0, describe(error).split(root).join(shown)));
    return [];
  }
}

/** What `--help` prints: what the gate proves, that it writes nothing, the fact that it reads no environment variable, and how it is run. */
const WIRING_USAGE: CliUsage = {
  name: 'check:wiring',
  summary: 'Fails on a dead @Injectable, a component neither routed nor used in a template, a route the tree and in-scope-routes.json disagree on, a spec without an expect, a credential-shaped literal, and a file outside the write boundary.',
  effects: [
    'judges every @Injectable under web-ng/src/app by whether a non-spec file injects it (AAP 0.10.4, criterion 7)',
    'judges every component by whether a route renders it or a template uses its selector (AAP 0.10.4, criterion 7)',
    'composes the routes app.routes.ts and the feature route files declare and compares them both ways with in-scope-routes.json (criterion 7)',
    'judges every spec file by whether it holds an expect (Rule 1 clause 8, criterion 7)',
    'judges every source and data file by the credential-shaped literals AAP 0.10.4 defines (Rule 1 clause 9, criterion 7)',
    'judges every path git reports outside web-ng/ against the base commit — added, modified or deleted — against scope-allowlist.json and the two root packaging files (criterion 8)',
    'writes nothing: the gate only reads the tree, the checkout\'s git objects and the two data files under web-ng/tools/parity',
  ],
  environment: [
    'none — the gate reads the tree, the checkout\'s git objects and the data files under web-ng/tools/parity, and no environment variable',
  ],
  examples: [
    'npm run check:wiring',
    'npm run check:all',
  ],
};

// A usage request is answered before the gate body runs, so `--help` reads no file, proves nothing and exits 0.
const intent = resolveCliIntent(WIRING_USAGE, process.argv.slice(2));
if (intent.kind === 'handled') {
  process.exitCode = intent.exitCode;
}
if (intent.kind === 'run') await runCheck(CHECK, async (): Promise<CheckOutcome> => {
  const violations: Violation[] = [];
  const notes: string[] = [];
  let routeFiles = 0;
  let routeDeclarations = 0;
  let routeLeaves = 0;
  let routesListed = 0;
  let injectables = 0;
  let injected = 0;
  let components = 0;
  let routed = 0;
  let templated = 0;
  let specs = 0;
  let specsWithExpect = 0;
  let judgedFiles = 0;
  let credentials = 0;
  let emptyCredentials = 0;
  let tenants = 0;
  let boundaryPaths = 0;
  let e2eSpecs = 0;
  const scannedFiles = new Set<string>();
  // The keys of `scanned` are the counter names AAP 0.10.4 and this file's specification state, so the summary line answers for each of them by name; the local names say which class produced each figure.
  const outcome = (): CheckOutcome => ({
    check: CHECK,
    violations,
    notes,
    scanned: {
      files: scannedFiles.size,
      routeFiles,
      routeDeclarations,
      routes: routeLeaves,
      routesListed,
      injectables,
      injected,
      components,
      routed,
      templated,
      specs,
      e2eSpecs,
      specsWithExpect,
      credentialFiles: judgedFiles,
      credentials,
      tenants,
      boundaryPaths,
    },
  });

  const routesData = await loadData(ROUTES_FILE, ROUTE_DRIFT, violations);
  if (routesData === null) {
    notes.push(`the route comparison below did not run, so this run gives the verdict of no class: ${dataFile(ROUTES_FILE)} could not be read`);
    return outcome();
  }
  const listed: ListedRoute[] = [];
  for (const row of asRows(routesData.document, 'routes')) {
    const path = asString(row, 'path');
    const kind = asString(row, 'kind');
    if (path === null || kind === null) {
      violations.push(violation(ROUTE_DRIFT, dataFile(ROUTES_FILE), 0, `a route row needs a string path and kind: ${JSON.stringify(row)}`));
      continue;
    }
    listed.push({ path, kind, redirectTo: asString(row, 'redirectTo'), line: lineOf(routesData.text, `"path": "${path}"`) });
  }
  routesListed = listed.length;

  let files: string[];
  try {
    files = await walk(APP_ROOT, { extensions: [ROUTE_SUFFIX] });
  } catch (error) {
    // A tree that cannot be read is not a tree that passed, so it fails at line 0 as check:endpoints does for a root.
    violations.push(violation(ROUTE_DRIFT, APP_ROOT_SHOWN, 0, describe(error).split(APP_ROOT).join(APP_ROOT_SHOWN)));
    return outcome();
  }
  if (files.length === 0) {
    violations.push(violation(ROUTE_DRIFT, APP_ROOT_SHOWN, 0, `holds no ${ROUTE_SUFFIX} file, so no route could be composed and an empty composition is not a route tree that agrees with the list`));
    return outcome();
  }
  const scans: RouteFileScan[] = countFiles(await Promise.all(files.map(async (file: string) => ({
    file,
    shown: relative(repoRoot, file).split(sep).join('/'),
    text: await readText(file),
  }))), scannedFiles);
  const count = (declarations: number): void => { routeDeclarations += declarations; };

  const declared: DeclaredRoute[] = [];
  const mounts = new Map<string, string>();
  const appScan = scans.find((scan) => scan.file === APP_ROUTES_FILE);
  if (appScan === undefined) {
    violations.push(violation(ROUTE_DRIFT, APP_ROUTES_SHOWN, 0, `is absent from ${APP_ROOT_SHOWN}, so no route can be composed from the root and no lazy group is mounted`));
  } else {
    routeFiles += 1;
    const composed = composeFile(appScan, '', count);
    declared.push(...composed.routes);
    for (const mount of composed.mounts) mounts.set(resolveSpecifier(appScan.file, mount.specifier), mount.prefix);
  }
  for (const scan of scans) {
    if (scan === appScan) continue;
    routeFiles += 1;
    const prefix = mounts.get(scan.file);
    if (prefix === undefined) {
      // The first declaration is named, so the finding points at the route that is not served rather than at the file.
      const unreachable = findRouteDeclarations(scan.text).at(0);
      violations.push(violation(ROUTE_DRIFT, scan.shown, unreachable?.line ?? 1, `no lazy route in ${APP_ROUTES_SHOWN} mounts this file, so the routes it declares — "${unreachable?.path ?? ''}" first — are unreachable and the routes the list expects are never served`));
      continue;
    }
    const composed = composeFile(scan, prefix, count);
    declared.push(...composed.routes);
    if (composed.mounts.length > 0) {
      for (const mount of composed.mounts) {
        violations.push(violation(ROUTE_DRIFT, scan.shown, mount.line, `declares the lazy group ${mount.specifier} under the prefix "${mount.prefix}", which this gate composes one level deep only — flatten the group, or extend the composition with the routes the list must then hold`));
      }
    }
  }
  routeLeaves = declared.length;

  // The list's own header names the files it was transcribed from, so a file it does not name is a data gap the run reports: a note when the file is composed anyway, and a finding when the named file is not there to be read.
  const header = asRecord(routesData.document['header']);
  const declaredInRows: unknown = header === null ? undefined : header['declaredIn'];
  const declaredIn: string[] = Array.isArray(declaredInRows)
    ? declaredInRows.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [];
  for (const entry of declaredIn) {
    if (!scans.some((scan) => scan.shown === entry)) {
      violations.push(violation(ROUTE_DRIFT, dataFile(ROUTES_FILE), lineOf(routesData.text, `"${entry}"`), `header.declaredIn names ${entry}, which is not a ${ROUTE_SUFFIX} file under ${APP_ROOT_SHOWN} — the list states a route file the tree does not hold`));
    }
  }
  for (const scan of scans) {
    if (!declaredIn.includes(scan.shown)) {
      notes.push(`${scan.shown} declares routes but header.declaredIn of ${dataFile(ROUTES_FILE)} does not name it; the file is composed and its routes are judged by the route rows`);
    }
  }

  // Both directions, because the list is the single statement of the tree (AAP 0.10.4): a route only the list holds is a screen the build does not serve, and a route only the tree holds is drift the list must record.
  for (const row of listed) {
    if (declared.some((route) => route.path === row.path)) continue;
    violations.push(violation(ROUTE_DRIFT, dataFile(ROUTES_FILE), row.line, `"${row.path}" is listed here as ${shapeOf(row.kind, row.redirectTo)}, but the tree declares no route at that path`));
  }
  for (const route of declared) {
    if (listed.some((row) => sameRoute(route.path, route.kind, route.redirectTo, row))) continue;
    const samePath = listed.find((row) => row.path === route.path);
    violations.push(samePath === undefined
      ? violation(ROUTE_DRIFT, route.file, route.line, `route "${route.path}" (${shapeOf(route.kind, route.redirectTo)}) is declared here but ${dataFile(ROUTES_FILE)} does not list it`)
      : violation(ROUTE_DRIFT, route.file, route.line, `route "${route.path}" is declared here as ${shapeOf(route.kind, route.redirectTo)}, but ${dataFile(ROUTES_FILE)} lists it as ${shapeOf(samePath.kind, samePath.redirectTo)} at line ${samePath.line} — the tree and the list must state one shape`));
  }

  // (a) dead-injectable. Every `@Injectable` the application declares must be reached by a non-spec file: a service nothing injects is dead code the build still ships, and the spec files are excluded because a spec.
  const appSource = countFiles(await readRoot(APP_ROOT, ['.ts'], DEAD_INJECTABLE, violations), scannedFiles);
  const appTexts = appSource.filter((file) => !file.shown.endsWith('.spec.ts')).map((file) => ({ shown: file.shown, text: stripComments(file.text) }));
  for (const file of appSource) {
    if (file.shown.endsWith('.spec.ts')) continue;
    for (const injectable of findInjectableClasses(file.text)) {
      injectables += 1;
      const consumed = appTexts.some((other) => other.shown !== file.shown && injectsName(other.text, injectable.name));
      if (consumed) {
        injected += 1;
        continue;
      }
      violations.push(violation(DEAD_INJECTABLE, file.shown, injectable.line, `${injectable.name} is @Injectable but no non-spec file under ${APP_ROOT_SHOWN} injects it, so nothing in the application reaches it (AAP 0.10.4, criterion 7)`));
    }
  }

  const routedNames = new Set<string>();
  for (const scan of scans) {
    for (const match of scan.text.matchAll(ROUTED_COMPONENT)) routedNames.add(match[1] ?? '');
    for (const match of scan.text.matchAll(LOADED_COMPONENT)) routedNames.add(match[1] ?? '');
    const lazyKeys = [...scan.text.matchAll(LOAD_COMPONENT_KEY)].length;
    const lazyMembers = [...scan.text.matchAll(LOADED_COMPONENT)].length;
    if (lazyKeys > lazyMembers) {
      notes.push(`${scan.shown} — ${lazyKeys - lazyMembers} loadComponent declaration(s) render a module export this gate cannot name from the source, so no component is credited to them`);
    }
  }
  const mainFile = join(webNgRoot, 'src', 'main.ts');
  let mainText = '';
  try {
    mainText = await readText(mainFile);
  } catch (error) {
    notes.push(`web-ng/src/main.ts cannot be read (${describe(error)}), so the bootstrap root is credited only by the template that renders it`);
  }
  for (const match of mainText.matchAll(BOOTSTRAPPED_ROOT)) routedNames.add(match[1] ?? '');
  const appAll = countFiles(await readRoot(APP_ROOT, APP_SUFFIXES, DEAD_COMPONENT, violations), scannedFiles);
  const templateParts: string[] = appAll.map((file) => commentFree(file.shown, file.text));
  const indexFile = join(webNgRoot, 'src', 'index.html');
  try {
    templateParts.push(commentFree('index.html', await readText(indexFile)));
  } catch (error) {
    notes.push(`web-ng/src/index.html cannot be read (${describe(error)}), so the document that carries the root component's selector is not part of the template search`);
  }
  const templateText = templateParts.join('\n');
  for (const file of appAll) {
    if (file.shown.endsWith('.spec.ts')) continue;
    for (const component of findComponentClasses(file.text)) {
      components += 1;
      const isRouted = routedNames.has(component.name);
      const isUsed = component.selector !== null && usesSelector(templateText, component.selector);
      if (isRouted) routed += 1;
      if (isUsed) templated += 1;
      if (isRouted || isUsed) continue;
      violations.push(violation(DEAD_COMPONENT, file.shown, component.line, component.selector === null
        ? `${component.name} declares no selector and no route renders it, so nothing can render it (AAP 0.10.4, criterion 7)`
        : `${component.name} (selector ${component.selector}) is neither routed nor used in a template, so nothing renders it (AAP 0.10.4, criterion 7)`));
    }
  }

  // (d) spec-without-expect. A spec asserts behaviour only through an expect, so a file without one proves nothing however much it sets up (Rule 1 clause 8).
  const specScans = countFiles(await readRoot(webNgRoot, SPEC_SUFFIXES, SPEC_WITHOUT_EXPECT, violations), scannedFiles);
  specs = specScans.length;
  for (const file of specScans) {
    if (hasExpect(file.text)) {
      specsWithExpect += 1;
      continue;
    }
    const described = lineOf(file.text, 'describe(');
    violations.push(violation(SPEC_WITHOUT_EXPECT, file.shown, described === 0 ? 1 : described, 'holds no expect, so it asserts nothing: a spec proves behaviour only through an expect (Rule 1 clause 8, AAP 0.10.4, criterion 7)'));
  }
  // The workflow specs `npm run e2e` executes live in the `testDir` the Playwright config sets (AAP 0.11.1).
  try {
    e2eSpecs = (await walk(E2E_SPECS_ROOT, { extensions: SPEC_SUFFIXES })).length;
    if (e2eSpecs === 0) {
      violations.push(violation(SPEC_WITHOUT_EXPECT, E2E_SPECS_SHOWN, 0, 'holds no workflow spec, so the parity suite `npm run e2e` executes would run nothing and no workflow would be proven (Rule 1 clause 8, AAP 0.10.4, criterion 7)'));
    }
  } catch (error) {
    violations.push(violation(SPEC_WITHOUT_EXPECT, E2E_SPECS_SHOWN, 0, `cannot be read, so the workflow specs it must hold were not judged: ${describe(error).split(E2E_SPECS_ROOT).join(E2E_SPECS_SHOWN)}`));
  }

  // (e) credential-literal, exactly as AAP 0.10.4 defines it: a property or variable named `password`, `pass`, `secret` or `authenticationKey` assigned a non-empty string literal, the login form's own `password` control (Rule 1 clause 9).
  notes.push(`${GENERATED_SKIP.join(', ')} are generated artefacts rather than source, so the credential class does not judge them`);
  const credentialScans = countFiles(await readRoot(webNgRoot, TEXT_SUFFIXES, CREDENTIAL_LITERAL, violations, GENERATED_SKIP), scannedFiles);
  for (const file of credentialScans) {
    if (file.shown.endsWith(`/${SELF_SKIPPED}`)) {
      notes.push(`${file.shown} is this gate, which states the credential rule it enforces and is exempt from being judged by it`);
      continue;
    }
    judgedFiles += 1;
    const text = commentFree(file.shown, file.text);
    const loginForm = LOGIN_FORM_FILE.test(file.shown) && LOGIN_CONTROL.test(text);
    for (const match of text.matchAll(CREDENTIAL_ASSIGNMENT)) {
      const name = match[1] ?? '';
      const value = match[3] ?? '';
      const line = lineAt(text, match.index);
      if (value.length === 0) {
        // AAP 0.10.4 forbids a NON-EMPTY literal, so an empty one is exempt by construction: it stores no secret.
        emptyCredentials += 1;
        continue;
      }
      if (value.includes('${')) {
        notes.push(`${file.shown}:${line} — ${name} is assigned a template literal whose value is composed at run time rather than stored, so the credential class does not judge it`);
        continue;
      }
      if (name === 'password' && loginForm) {
        notes.push(`${file.shown}:${line} — the login form's own password control name is exempt (AAP 0.10.4), because it names an input rather than storing a value`);
        continue;
      }
      credentials += 1;
      violations.push(violation(CREDENTIAL_LITERAL, file.shown, line, `${name} is assigned a non-empty string literal, which AAP 0.10.4 forbids in source; read the value from the environment instead. The value itself is not printed (Rule 1 clause 9)`));
    }
    tenants += [...text.matchAll(TENANT_LITERAL)].length;
  }
  if (tenants > 0) {
    notes.push(`${tenants} tenant-identifier literal(s) were seen and left alone: AAP 0.10.4 keeps the tenant identifier outside the credential gate, because the build carries the tenant to call with rather than data about a real tenant`);
  }
  if (emptyCredentials > 0) {
    notes.push(`${emptyCredentials} credential-shaped field(s) were assigned an empty literal and left alone: AAP 0.10.4 forbids a non-empty one, and an empty literal stores no secret`);
  }

  // (f) write-boundary, judged the way criterion 8 judges it: a `git diff` against the base commit rather than a listing of the repository root.
  const scopeData = await loadData(SCOPE_FILE, WRITE_BOUNDARY, violations);
  const allowedPaths = new Set<string>();
  if (scopeData !== null) {
    for (const row of asRows(scopeData.document, 'paths')) {
      const path = asString(row, 'path');
      const reason = asString(row, 'reason');
      if (path === null) {
        violations.push(violation(WRITE_BOUNDARY, dataFile(SCOPE_FILE), 0, `a listed path needs a string path: ${JSON.stringify(row)}`));
        continue;
      }
      const line = lineOf(scopeData.text, `"path": "${path}"`);
      if (reason === null || reason.trim() === '') {
        violations.push(violation(WRITE_BOUNDARY, dataFile(SCOPE_FILE), line, `"${path}" is listed without a stated reason, and every listed path must say what it is for (scope-allowlist.json header)`));
      }
      if (path === 'web-ng' || path.startsWith('web-ng/')) {
        violations.push(violation(WRITE_BOUNDARY, dataFile(SCOPE_FILE), line, `"${path}" lies inside the write boundary already: web-ng/** may be occupied without an entry, and no application file may be listed here (AAP 0.10.4)`));
      }
      if (ROOT_ADDITIONS.includes(path)) {
        notes.push(`${dataFile(SCOPE_FILE)} lists "${path}", which the work may add without an entry; the entry is redundant rather than harmful`);
      }
      allowedPaths.add(path);
    }
  }
  const allowed = (shown: string): boolean => ROOT_ADDITIONS.includes(shown)
    || [...allowedPaths].some((entry) => shown === entry || shown.startsWith(entry.endsWith('/') ? entry : `${entry}/`));
  // Every listing is read before any path is judged, so a git read that fails reports one finding rather than a partial verdict, and each path the run judged outside `web-ng/` is counted for the summary line.
  const judged = new Set<string>();
  try {
    const roots: string[] = (await git(['rev-list', '--max-parents=0', 'HEAD']))
      .split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => line.length > 0);
    const base = roots[roots.length - 1];
    if (base === undefined) {
      throw new Error('git rev-list --max-parents=0 HEAD named no commit to judge against');
    }
    const [changed, untracked, tracked] = await Promise.all([
      git(['diff', '--name-status', '-z', '--no-renames', base]),
      git(['ls-files', '--others', '--exclude-standard', '-z']),
      git(['ls-tree', '-r', '--name-only', '-z', base]),
    ]);
    const baseTracked = splitZ(tracked).filter((path: string): boolean => !isUnderWebNg(path));
    for (const path of baseTracked) {
      judged.add(path);
    }
    // One rule, applied per path: `web-ng/**` is the work's own tree; the two packaging files and the allowlist excuse an addition only; a path the base commit tracks stays byte-identical, so changing or removing it is a failure the gate reports.
    const judge = (path: string, status: string): void => {
      if (path === '' || isUnderWebNg(path)) return;
      judged.add(path);
      if (status === 'M' || status === 'T') {
        violations.push(violation(WRITE_BOUNDARY, path, 0, 'is tracked at the base commit and has been modified, and every path outside web-ng/** must stay byte-identical (AAP 0.4.4 item 2, criterion 8)'));
        return;
      }
      if (status === 'D') {
        violations.push(violation(WRITE_BOUNDARY, path, 0, 'is tracked at the base commit and has been deleted, and every path outside web-ng/** must stay byte-identical (AAP 0.4.4 item 2, criterion 8)'));
        return;
      }
      if (allowed(path)) return;
      if (status === 'A' || status === '?') {
        violations.push(violation(WRITE_BOUNDARY, path, 1, OUTSIDE_BOUNDARY));
        return;
      }
      violations.push(violation(WRITE_BOUNDARY, path, 0, `is outside the write boundary and carries the git status "${status}", which is neither an addition, a modification nor a deletion, so the gate reports rather than passes it (AAP 0.4.4 item 2, criterion 8)`));
    };
    for (const change of readChanges(changed)) {
      judge(change.path, change.status);
    }
    for (const path of splitZ(untracked)) {
      judge(path, '?');
    }
    boundaryPaths = judged.size;
    const shortBase = base.slice(0, 7);
    const trackedOutside = [...baseTracked].sort().join(', ');
    notes.push(`the write boundary was judged against base commit ${shortBase}, this repository's initial commit resolved at run time with git rev-list --max-parents=0 HEAD, which is the commit every path of the work's diff is measured from`);
    notes.push(`${baseTracked.length} path(s) tracked at base commit ${shortBase} lie outside web-ng/ and are therefore existing content rather than additions: ${trackedOutside === '' ? 'none' : trackedOutside}`);
    notes.push('a git-ignored path is never judged as an addition, because the untracked listing is read with --exclude-standard');
  } catch (error) {
    const reason = describe(error).split(repoRoot).join('');
    violations.push(violation(WRITE_BOUNDARY, '.', 0, `the write boundary cannot be judged, so no path outside web-ng/ was checked: git must run in this checkout as a work tree and its initial commit must resolve, and reading it failed with: ${reason}`));
  }

  return outcome();
});
