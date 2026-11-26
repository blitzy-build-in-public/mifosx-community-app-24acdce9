/// <reference types="node" />
// npm run check:wiring — AAP 0.10.4 row 3, criteria 7 and 8. One gate for the wiring of the tree and for the boundary
// it may occupy, failing on each violation class AAP 0.10.4 names:
//
//   (a) dead-injectable      an `@Injectable` that nothing injects.
//   (b) dead-component       a component that is neither routed nor used in a template.
//   (c) route-drift          a route the tree declares and in-scope-routes.json does not list, or a route the list
//                            holds and the tree does not declare — the list is the single statement of the route tree
//                            (AAP 0.10.4 "Allowlist rules"), so the comparison runs both ways.
//   (d) spec-without-expect  a spec file with no `expect` (Rule 1 clause 8, AAP 0.11.1), and the absent or empty
//                            `web-ng/e2e/specs` directory the Playwright config sets as its `testDir`, since a suite
//                            that is not there runs nothing.
//   (e) credential-literal   a property or variable named `password`, `pass`, `secret` or `authenticationKey` assigned
//                            a non-empty string literal, with the login form's own `password` control name exempt
//                            because it names an input rather than storing a value, and the tenant identifier
//                            deliberately outside the gate (AAP 0.10.4 "Credential gate, defined once").
//   (f) write-boundary       a path outside the boundary, judged the way criterion 8 judges it: an added path outside
//                            `web-ng/**`, the two root packaging files and the root paths scope-allowlist.json names, or a
//                            path the base commit tracks that has been modified or deleted (AAP 0.4.4 item 2 and
//                            criterion 8, which this gate asserts).
//
// **Composition of the route tree (class c).** `in-scope-routes.json` states in its header how a full path is built:
// "full paths are app-level parent segments joined with feature child segments; lazy groups mount at path ''". The gate
// composes the same way the router does, from the source text rather than from the loaded value, so it can judge the
// tree the build ships: each `path:` entry of a `Routes` array is composed with the full path of the entries enclosing
// it, the enclosing entries being the ones written at a lower brace depth — a route's `children` sit one `{` deeper
// than the route itself. Two shapes are composition points rather than screens and so are never compared as routes:
// an entry declaring `children: [...]`, whose screens are those children, and an entry declaring `loadChildren`, whose
// screens are the entries of the route file it imports. The file is resolved from its import specifier, and the
// composition point's own full path becomes that file's prefix. 24 declarations therefore compose to the 19 leaves the
// list holds: the guarded shell container, the `login` mount and the three empty-path lazy mounts contribute prefixes
// only. Each leaf is compared with its `kind` and, for a redirect, its `redirectTo`, so a route that changes shape
// without the list changing is reported too.
//
// **What a violation never prints (Rule 1 clause 9).** A credential-shaped finding names the property, the file and the
// line, and never the literal's value: the value is what the rule exists to keep out of logs, console output and
// captured traffic, and this gate's output is none of the three that may carry it.
//
// **Nothing is skipped in silence (AAP 0.14.1).** Every class reports its coverage on the summary line, and anything the
// gate deliberately passes over — a generated artefact rather than source, the tenant identifier outside the credential
// rule, a route file the data file's header does not name — is a `note:` line with its file and the reason. A scan root
// that cannot be read fails at line 0 instead of passing on an empty list, because the least-checkable tree must not be
// the one that passes.
//
// **There is no suppression list.** No allowlist of exempt files, components, injectables or specs exists: an
// `@Injectable` nothing injects and a component nothing renders are violations, which is this gate's purpose. The only
// things passed over are the ones this comment names and the run reports on its own `note:` lines — generated artefacts
// rather than source, this gate's own file, and the shapes AAP 0.10.4 exempts by definition (an empty credential
// literal, the login form's control name, the tenant identifier) — each counted and named, never silent. A violation is
// fixed at its cause, never excused here.
//
// **Negative control.** Every class was shown biting on a planted violation in a throwaway copy of this tree outside the
// checkout, with this tree left as found, since a violating file may never be added here to prove the gate works. The
// copy planted a dead `@Injectable`, a component nothing renders, a route only the tree declared, a route only the list
// held, a route file no lazy route mounts, a redirect whose target the list states differently, a spec with no `expect`,
// a `secret` assigned a literal (and the same shape in the login template, whose `password` control name stayed exempt
// while its `secret` failed), a file and a directory written at the repository root, a modification and a deletion of a
// path tracked at the base commit, and each was reported with its file and line while the same copy unplanted exited 0.
//
// **Why the base commit, and why the initial one.** Criterion 8 is a `git diff` against the base commit: no modified or
// deleted tracked file outside `web-ng/`, and additions limited to the two root packaging files and the paths
// scope-allowlist.json names. Class (f) therefore reads the checkout's own git objects instead of the occupancy of the
// repository root, so content the work never wrote is judged by what it is rather than by that it exists: a legacy
// `app/` or `test/` tree the base commit already tracks is existing content, the platform's root evidence directory is
// allowlisted by name in scope-allowlist.json rather than passed over in silence, and a tracked deletion — which a
// filesystem listing cannot see at all — is reported. The base is the repository's initial commit, resolved at run time
// with `git rev-list --max-parents=0 HEAD`, because every path this work's diff measures is measured from that commit and
// resolving it from the checkout needs no argument and no environment variable to be set correctly.
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
/** Repository root, so every reported path is repo-relative and identical on every machine. */
const repoRoot: string = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'check:wiring';
const ROUTES_FILE = 'in-scope-routes.json';
const SCOPE_FILE = 'scope-allowlist.json';
/** Repo-relative path of one parity data file: the name every finding about a list carries. */
const dataFile = (name: string): string => `web-ng/tools/parity/${name}`;
const APP_ROOT = join(webNgRoot, 'src', 'app');
const APP_ROOT_SHOWN = 'web-ng/src/app';
/** The route file that mounts every other one; its declarations compose from the root prefix. */
const APP_ROUTES_FILE = join(APP_ROOT, 'app.routes.ts');
const APP_ROUTES_SHOWN = 'web-ng/src/app/app.routes.ts';
/** Suffix of a route file, which is what `walk` keeps when the route tree is read. */
const ROUTE_SUFFIX = '.routes.ts';
/** Files that can hold a component, an injectable or a template, which is what classes (a) and (b) judge. */
const APP_SUFFIXES: readonly string[] = ['.ts', '.html'];
/** Spec files, whichever runner owns them; class (d) judges each of them. */
const SPEC_SUFFIXES: readonly string[] = ['.spec.ts', '.test.ts'];
/** The `testDir` the Playwright config sets, holding the workflow specs `npm run e2e` executes. */
const E2E_SPECS_ROOT = join(webNgRoot, 'e2e', 'specs');
const E2E_SPECS_SHOWN = 'web-ng/e2e/specs';
/** Files a credential-shaped literal can be written in: source, templates, configuration and operational scripts. */
const TEXT_SUFFIXES: readonly string[] = ['.ts', '.html', '.json', '.sh', '.yml', '.yaml'];
/** Generated artefacts rather than source, so no class judges them (they are gitignored build and report output). */
const GENERATED_SKIP: readonly string[] = ['.captures', 'parity-report.json', 'parity-report.md'];
/** This gate's own file: it states the rule it enforces, so it is exempt from class (e) with a note, never in silence. */
const SELF_SKIPPED = 'check-wiring.ts';
/** The two files this work may add at the repository root, beside everything `web-ng/**` holds (AAP 0.4.4 item 2). */
const ROOT_ADDITIONS: readonly string[] = ['Dockerfile.web-ng', 'docker-compose.web-ng.yml'];
/** The sentence every added path outside the boundary carries, so the diff and the untracked list state one rule. */
const OUTSIDE_BOUNDARY = 'is outside the write boundary: the work may occupy web-ng/** and add only Dockerfile.web-ng, docker-compose.web-ng.yml and the root files scope-allowlist.json names (AAP 0.4.4 item 2, criterion 8)';

const DEAD_INJECTABLE = 'dead-injectable';
const DEAD_COMPONENT = 'dead-component';
const ROUTE_DRIFT = 'route-drift';
const SPEC_WITHOUT_EXPECT = 'spec-without-expect';
const CREDENTIAL_LITERAL = 'credential-literal';
const WRITE_BOUNDARY = 'write-boundary';

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

/** A thrown value is arbitrary data; only the message a reader can act on is kept. */
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** git, programmatically: no shell ever interprets a path, and every read is decoded as UTF-8 text. */
const execFileAsync = promisify(execFile);
/** Options every git read shares: the checkout as working directory, a buffer past any path list, UTF-8 output. */
const GIT_OPTIONS: ExecFileOptionsWithStringEncoding = { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' };

/** One path git reports as changed against the base commit, or as untracked, with the status letter it carries. */
interface Change { status: string; path: string }

/** Splits one NUL-separated git listing into its fields, dropping the empty field the final separator leaves. */
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

/**
 * Runs one git command in the checkout and returns its standard output. The read either arrives whole or the call
 * throws, so gate (f) reports a listing it could not read rather than judging a truncated one.
 *
 * @param args The git arguments, already split into words: no shell parses them.
 */
async function git(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, GIT_OPTIONS);
  return stdout;
}

/** A data file and the text it was parsed from, so a finding about a row can name the row's own line. */
interface LoadedData { document: Record<string, unknown>; text: string }

/** Reads one parity data file; a list that cannot be loaded is a violation, because it cannot then be enforced. */
async function loadData(name: string, rule: string, violations: Violation[]): Promise<LoadedData | null> {
  const location = new URL(`./${name}`, import.meta.url);
  try {
    const text: string = await readText(fileURLToPath(location));
    const parsed: unknown = JSON.parse(text);
    const document = asRecord(parsed);
    if (document === null) throw new Error('the file does not hold a JSON object');
    return { document, text };
  } catch (error) {
    // The OS error names an absolute path, so it is rewritten to the repo-relative one for a machine-independent log.
    const reason = describe(error).split(fileURLToPath(location)).join(dataFile(name));
    violations.push(violation(rule, dataFile(name), 0, `cannot be read, so the class it settles cannot be judged: ${reason}`));
    return null;
  }
}

/** 1-based line of the first occurrence of `needle` in `text`, or 0 when it is not there to be pointed at. */
function lineOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  return at < 0 ? 0 : text.slice(0, at).split('\n').length;
}

/** The three shapes `in-scope-routes.json` distinguishes; a composition point is none of them and is never listed. */
type RouteKind = 'component' | 'redirect' | 'wildcard';

/** One route the tree declares as a screen: its full path, its shape, and where it is written. */
interface DeclaredRoute { path: string; kind: RouteKind; redirectTo: string | null; file: string; line: number }

/** One route row of `in-scope-routes.json`, with the line it is written on. */
interface ListedRoute { path: string; kind: string; redirectTo: string | null; line: number }

/** One `path:` entry as its file writes it, with what decides whether it is a screen or a composition point. */
interface ParsedRoute { decl: RouteDecl; depth: number; children: boolean; loadChildren: boolean; loadComponent: boolean }

/** A `loadChildren` import: the route file it names, the prefix its own full path contributes, and where it is written. */
interface Mount { specifier: string; prefix: string; line: number }

/** Every `path:` key of a `Routes` array: the same literal `findRouteDeclarations` reads, kept with its offset. */
const PATH_KEY = /\bpath\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * Brace depth at ascending offsets of one file, advancing a single pass through it: a route's `children` entries are
 * written one `{` deeper than the route that owns them, which is what nests a declared path under its parent. Quoted
 * strings and their escapes are skipped, so a brace inside a template or a message never shifts a depth.
 *
 * @param text Comment-free text; queries must be made in ascending offset order.
 * @returns A reader answering the depth of `{` open at the offset it is asked about.
 */
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

/**
 * Places each `path:` entry of one route file at its brace depth and reads what follows it up to the next entry: the
 * text that tells a composition point (`children: [` or `loadChildren`) from a screen. The body is the slice between
 * one `path:` key and the next, which is where a route's own `children` opener sits, above its first child's path.
 *
 * @param stripped Comment-free text of the file, in the coordinates the declarations were located in.
 * @param decls The file's declarations, in source order, as `findRouteDeclarations` reports them.
 */
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

/** The shape one entry renders: a redirect, the catch-all, or a component — `loadComponent` renders one as well. */
function kindOf(entry: ParsedRoute): RouteKind {
  if (entry.decl.redirectTo !== null) return 'redirect';
  return entry.loadComponent || entry.decl.path !== '**' ? 'component' : 'wildcard';
}

/** The prefix a lower entry's full path is joined to, or `base` when the entry opens a new top-level branch. */
function enclosingPrefix(open: readonly { depth: number; prefix: string }[], base: string): string {
  return open.at(-1)?.prefix ?? base;
}

/**
 * Composes one route file's declarations into the full paths the router serves, and collects the lazy mounts it
 * declares. An entry's full path is its enclosing route's full path joined to its own path, empty segments dropped —
 * the composition `in-scope-routes.json` states in its header — so the empty path of a lazy group's mount disappears
 * into its parent and a feature file's `clients` stays `clients`. A composition point contributes its full path as the
 * prefix for what it encloses and is not itself a route: its screens are its children or the entries of the file it
 * imports. Lazy mounts are only bracketed by composition points, so they are collected rather than composed further;
 * the caller resolves their specifiers to the files whose prefixes they become.
 *
 * @param parsed One file's entries, in source order, each at its brace depth.
 * @param base The prefix the file itself is mounted under: `''` for `app.routes.ts`, the mount's full path otherwise.
 * @param file Repo-relative name of the file, so every composed route can be reported where it is written.
 */
function composeRoutes(parsed: readonly ParsedRoute[], base: string, file: string): { routes: DeclaredRoute[]; mounts: Mount[] } {
  const routes: DeclaredRoute[] = [];
  const mounts: Mount[] = [];
  const open: { depth: number; prefix: string }[] = [];
  for (const entry of parsed) {
    // A sibling closes every entry opened at its own depth or deeper, so the stack is exactly the enclosing chain.
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

/** One scanned route file: its path, its repo-relative name, and the text the declarations are read from. */
interface RouteFileScan { file: string; shown: string; text: string }

/**
 * Reads one route file and composes it at the prefix it is mounted under, counting the declarations it holds.
 *
 * @param scan The file, already read.
 * @param base The prefix its own routes hang off.
 * @param count Callback that adds the file's declaration count to the run's coverage figures.
 */
function composeFile(scan: RouteFileScan, base: string, count: (declarations: number) => void): { routes: DeclaredRoute[]; mounts: Mount[] } {
  const decls: RouteDecl[] = findRouteDeclarations(scan.text);
  count(decls.length);
  const parsed = parseRoutes(stripComments(scan.text), decls);
  if (parsed.length !== decls.length) {
    // A `path:` declaration the composer could not place would drop a screen from the comparison in silence, so the run
    // fails with the file named rather than passing on the routes it happened to place.
    throw new Error(`${scan.shown}: ${decls.length - parsed.length} of ${decls.length} path: declaration(s) could not be placed, so the route tree could not be composed`);
  }
  return composeRoutes(parsed, base, scan.shown);
}

/** True when two keys name the same route, compared on the path, the shape and the redirect target the list states. */
const sameRoute = (path: string, kind: string, redirectTo: string | null, other: { path: string; kind: string; redirectTo: string | null }): boolean =>
  path === other.path && kind === other.kind && (redirectTo ?? '') === (other.redirectTo ?? '');

/** How a route's shape reads in a finding: its kind, and the redirect target when it has one. */
const shapeOf = (kind: string, redirectTo: string | null): string => (redirectTo === null ? `kind ${kind}` : `kind ${kind} redirecting to ${redirectTo}`);

/** A regex-safe form of an identifier or a selector read out of source. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when one file injects the class `name` names: through `inject(Name)`, which is how a functional interceptor
 * and an initializer reach a dependency, or through a typed field or constructor parameter (`: Name`), which is how a
 * class-based consumer declares one. The declaring file is the caller's to exclude, because a service that names its
 * own class injects nothing.
 */
function injectsName(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return new RegExp(`\\binject\\s*\\(\\s*${escaped}\\s*[,)]`).test(text)
    || new RegExp(`:\\s*${escaped}\\s*[,;)}=]`).test(text);
}

/**
 * True when a template renders the component `selector` names. An element selector is matched where the tag opens; an
 * attribute selector (`[hasPermission]`, `input[type=date][appDateValue]`) is matched by every attribute it requires,
 * which is how the template writes it; any other selector is matched by the name it carries.
 */
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

/**
 * A property or variable named `password`, `pass`, `secret` or `authenticationKey` assigned a quoted literal, which is
 * the shape AAP 0.10.4 "Credential gate, defined once" forbids. The name must stand on its own, so `formControlName`
 * and `newPasswordPolicy` are not matches; the assignment may be a property (`name: '…'`) or a variable (`name = '…'`),
 * and `=` is not taken from `==`, `===` or `=>`. Literals of all three quote forms are read, and one holding a `${…}`
 * interpolation is composed at run time rather than stored, so the caller notes it instead of failing it.
 */
const CREDENTIAL_KEYS: readonly string[] = ['password', 'pass', 'secret', 'authenticationKey'];
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(?:^|[^\\w$])(${CREDENTIAL_KEYS.join('|')})\\s*(?::|=(?!=))\\s*(['"\`])((?:\\\\.|(?!\\2)[^\\\\])*)\\2`,
  'g',
);
/** The login form's own `password` control name, written where the input is declared (AAP 0.10.4's exemption). */
const LOGIN_CONTROL = /\b(?:formControlName|name)\s*=\s*["']password["']/;
/** The login screen's own files, the only place that control name is written. */
const LOGIN_FORM_FILE = /(?:^|\/)features\/auth\/login\/login\.component\.(?:ts|html)$/;
/** The tenant identifier, which AAP 0.10.4 leaves outside the credential gate by definition. */
const TENANT_LITERAL = /\b(?:tenantId|tenantIdentifier)\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * The text of one file with its comments blanked, in the coordinates the file's own offsets use: TypeScript comments
 * through the shared scanner, an HTML comment blanked whole, and a format that carries no comment left as written.
 * A credential-shaped literal written inside a comment is not an assignment and is not reported, while the offsets of
 * everything a file does declare stay exactly where the reader locates them.
 */
function commentFree(file: string, text: string): string {
  if (file.endsWith('.ts')) return stripComments(text);
  if (file.endsWith('.html')) return text.replace(/<!--[\s\S]*?-->/g, (match: string): string => match.replace(/[^\n]/g, ' '));
  return text;
}

/** 1-based line of an offset, so a finding names the line the literal is written on. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/** One file read for a class that judges it: its repo-relative name, and its text as the file writes it. */
interface ScannedFile { shown: string; text: string }

/** Reads a set of files once, in the order they were listed, keeping each file's repo-relative name. */
async function scanFiles(files: readonly string[]): Promise<ScannedFile[]> {
  return Promise.all(files.map(async (file: string) => ({
    shown: relative(repoRoot, file).split(sep).join('/'),
    text: await readText(file),
  })));
}

/**
 * Adds one class's scanned files to the run's distinct-file count and returns them unchanged, so the count states how
 * much of the tree the run actually read rather than how many classes read it.
 *
 * @param files The files one class read.
 * @param into The run's set of distinct repo-relative names.
 * @returns `files`, so a caller keeps the expression it was reading.
 */
function countFiles<T extends ScannedFile>(files: T[], into: Set<string>): T[] {
  for (const file of files) into.add(file.shown);
  return files;
}

/**
 * Reads one scan root for the class it serves. A root that cannot be listed fails that class at line 0 rather than
 * passing on an empty list, because the least-checkable tree must not be the one that passes; a root that lists but
 * holds nothing scannable is reported the same way, for the same reason.
 *
 * @param root Absolute directory to walk.
 * @param extensions Suffixes to keep; empty keeps every file.
 * @param rule The class a failure of this root belongs to.
 * @param violations The run's findings.
 * @param skip Entry names `walk` passes over beyond its built-in set.
 */
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

/**
 * What `--help` prints (finding 406f-F02): what the gate proves, that it writes nothing, the fact that
 * it reads no environment variable, and how it is run.
 */
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

// A usage request is answered before the gate body runs, so `--help` reads no file and proves nothing
// (finding 406f-F02). The code goes on process.exitCode, never through process.exit(), so a piped
// summary line is never lost.
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
  // The keys of `scanned` are the counter names AAP 0.10.4 and this file's specification state, so the summary line
  // answers for each of them by name; the local names say which class produced each figure.
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

  // The application route file first, because the prefixes every other file hangs off are the mounts it declares.
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
      // A nested lazy group would need its prefix composed through a second level; none is declared today, and a gate
      // that accepted one silently would report its screens as absent from the list instead of naming the real gap.
      for (const mount of composed.mounts) {
        violations.push(violation(ROUTE_DRIFT, scan.shown, mount.line, `declares the lazy group ${mount.specifier} under the prefix "${mount.prefix}", which this gate composes one level deep only — flatten the group, or extend the composition with the routes the list must then hold`));
      }
    }
  }
  routeLeaves = declared.length;

  // The list's own header names the files it was transcribed from, so a file it does not name is a data gap the run
  // reports: a note when the file is composed anyway, and a finding when the named file is not there to be read.
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

  // Both directions, because the list is the single statement of the tree (AAP 0.10.4): a route only the list holds is
  // a screen the build does not serve, and a route only the tree holds is drift the list must record. A path both sides
  // state is judged once, from the tree's side, where the file and line of the declaration can be named.
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

  // (a) dead-injectable. Every `@Injectable` the application declares must be reached by a non-spec file: a service
  // nothing injects is dead code the build still ships, and the spec files are excluded because a spec injecting a
  // service is a test reaching it, not the application using it.
  const appSource = countFiles(await readRoot(APP_ROOT, ['.ts'], DEAD_INJECTABLE, violations), scannedFiles);
  const appTexts = appSource.filter((file) => !file.shown.endsWith('.spec.ts')).map((file) => ({ shown: file.shown, text: stripComments(file.text) }));
  for (const file of appSource) {
    if (file.shown.endsWith('.spec.ts')) continue;
    for (const injectable of findInjectableClasses(file.text)) {
      injectables += 1;
      // A service that names its own class injects nothing, so its declaring file is not a consumer of it.
      const consumed = appTexts.some((other) => other.shown !== file.shown && injectsName(other.text, injectable.name));
      if (consumed) {
        injected += 1;
        continue;
      }
      violations.push(violation(DEAD_INJECTABLE, file.shown, injectable.line, `${injectable.name} is @Injectable but no non-spec file under ${APP_ROOT_SHOWN} injects it, so nothing in the application reaches it (AAP 0.10.4, criterion 7)`));
    }
  }

  // (b) dead-component. A component is wired when a route renders it or a template uses its selector. Routes are read
  // from the same route files class (c) composed, so a route the list does not hold still counts as wiring — the route
  // class, not this one, is where that disagreement is reported.
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
  // The root component is mounted by bootstrapApplication rather than by a route, which is what index.html's selector
  // and the application's entry file state between them.
  const mainFile = join(webNgRoot, 'src', 'main.ts');
  let mainText = '';
  try {
    mainText = await readText(mainFile);
  } catch (error) {
    notes.push(`web-ng/src/main.ts cannot be read (${describe(error)}), so the bootstrap root is credited only by the template that renders it`);
  }
  for (const match of mainText.matchAll(BOOTSTRAPPED_ROOT)) routedNames.add(match[1] ?? '');
  const appAll = countFiles(await readRoot(APP_ROOT, APP_SUFFIXES, DEAD_COMPONENT, violations), scannedFiles);
  // Every template the application renders: the external ones, the root index.html the build serves, and each
  // component file's own text, so an inline template is read on the same footing as a separate file.
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

  // (d) spec-without-expect. A spec asserts behaviour only through an expect, so a file without one proves nothing
  // however much it sets up (Rule 1 clause 8).
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
  // The workflow specs `npm run e2e` executes live in the `testDir` the Playwright config sets (AAP 0.11.1). A root that
  // is absent or holds no spec is a suite that runs nothing, so it fails under the class that judges specs rather than
  // passing on whatever spec files happen to sit elsewhere in the package.
  try {
    e2eSpecs = (await walk(E2E_SPECS_ROOT, { extensions: SPEC_SUFFIXES })).length;
    if (e2eSpecs === 0) {
      violations.push(violation(SPEC_WITHOUT_EXPECT, E2E_SPECS_SHOWN, 0, 'holds no workflow spec, so the parity suite `npm run e2e` executes would run nothing and no workflow would be proven (Rule 1 clause 8, AAP 0.10.4, criterion 7)'));
    }
  } catch (error) {
    violations.push(violation(SPEC_WITHOUT_EXPECT, E2E_SPECS_SHOWN, 0, `cannot be read, so the workflow specs it must hold were not judged: ${describe(error).split(E2E_SPECS_ROOT).join(E2E_SPECS_SHOWN)}`));
  }

  // (e) credential-literal, exactly as AAP 0.10.4 defines it: a property or variable named `password`, `pass`, `secret`
  // or `authenticationKey` assigned a non-empty string literal, the login form's own `password` control name exempt,
  // and the tenant identifier outside the gate. The value is never printed (Rule 1 clause 9).
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

  // (f) write-boundary, judged the way criterion 8 judges it: a `git diff` against the base commit rather than a listing
  // of the repository root. An added path outside `web-ng/**`, the two root packaging files and the root paths
  // scope-allowlist.json names leaves the boundary, and so does a path the base commit tracks that has been modified or
  // deleted — the allowlist excuses an addition, never a change to content the work must leave byte-identical. The scope
  // allowlist is validated first, because a list that could excuse anything would enforce nothing.
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
  // Every listing is read before any path is judged, so a git read that fails reports one finding rather than a partial
  // verdict, and each path the run judged outside `web-ng/` is counted for the summary line.
  const judged = new Set<string>();
  try {
    const roots: string[] = (await git(['rev-list', '--max-parents=0', 'HEAD']))
      .split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => line.length > 0);
    // rev-list prints newest first, so the last line is the repository's initial commit.
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
    // One rule, applied per path: `web-ng/**` is the work's own tree; the two packaging files and the allowlist excuse an
    // addition only; a path the base commit tracks stays byte-identical, so changing or removing it is a finding even
    // when the allowlist names it; and a status the gate does not classify is reported rather than passed.
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
    // The OS and git errors name the checkout's absolute path, so it is trimmed to keep the log machine-independent.
    const reason = describe(error).split(repoRoot).join('');
    violations.push(violation(WRITE_BOUNDARY, '.', 0, `the write boundary cannot be judged, so no path outside web-ng/ was checked: git must run in this checkout as a work tree and its initial commit must resolve, and reading it failed with: ${reason}`));
  }

  return outcome();
});
