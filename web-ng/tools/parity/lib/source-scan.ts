/// <reference types="node" />
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** `web-ng/`, resolved from this file's URL and never from `process.cwd()`. */
export const webNgRoot: string = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const repoRoot: string = resolve(webNgRoot, '..');
/** Filters for `walk`: `extensions` keeps matching suffixes, `skip` extends the built-in skip set. */
export interface WalkOptions { extensions?: readonly string[]; skip?: readonly string[] }
export interface Located { line: number; column: number }
/** A quoted literal of a scanned file: `start` is the offset of its opening quote and `end` the offset just past its closing quote, both in the text handed to {@link findUrlLiterals}, so a caller can slice the glue between two literals. */
export interface Literal extends Located { value: string; start: number; end: number }
/** A `path:` entry of a `Routes` array with the mechanism that decides where it leads. */
export interface RouteDecl extends Located { path: string; kind: 'component' | 'redirect' | 'wildcard' | 'lazy'; redirectTo: string | null; lazySpecifier: string | null }
export interface InjectableDecl { name: string; line: number }
export interface ComponentDecl { name: string; selector: string | null; line: number }
const DEFAULT_SKIP: readonly string[] = ['node_modules', '.git', 'dist', 'out-tsc', '.angular', 'coverage', 'playwright-report', 'test-results', '.captures'];
const COMMENT_OR_STRING = /(['"`])(?:\\.|(?!\1)[^\\])*\1|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
export function stripComments(text: string): string {
  return text.replace(COMMENT_OR_STRING, (match: string, quote: string | undefined) => (quote === undefined ? match.replace(/[^\n]/g, ' ') : match));}
/** Recursive, sorted, absolute file list under `root`; consumed by all three parity gates. */
export async function walk(root: string, options: WalkOptions = {}): Promise<string[]> {
  const skip = new Set<string>([...DEFAULT_SKIP, ...(options.skip ?? [])]);
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (!options.extensions || options.extensions.some((suffix) => entry.name.endsWith(suffix))) files.push(full);}};
  try { await visit(root); } catch (error) {
    throw new Error(`required scan root is missing or unreadable: ${resolve(root)} (${error instanceof Error ? error.message : String(error)})`);
  }
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
export async function readText(file: string): Promise<string> { return readFile(file, 'utf8'); }
const locate = (text: string, offset: number): Located =>
  ({ line: text.slice(0, offset).split('\n').length, column: offset - text.lastIndexOf('\n', offset - 1) });
const STRINGS = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/y;
const literalEnd = (text: string, start: number): number => {
  QUOTED.lastIndex = start;
  const match = QUOTED.exec(text);
  return match === null ? text.length : start + match[0].length;};
export function findUrlLiterals(text: string): Literal[] {
  const stripped = stripComments(text);
  return [...stripped.matchAll(STRINGS)].map((match) => {
    const start = match.index;
    return { value: match.at(2) ?? '', start, end: start + match[0].length, ...locate(stripped, start) };});}
const STATIC_PREFIXES: readonly string[] = ['/assets', '/images', '/global-translations', '/fonts', '/favicon'];
/** True for an in-place static asset (translations, images, fonts), which is never a Fineract URL. */
export function isStaticAsset(value: string): boolean {
  return STATIC_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix)) || /\.[a-z0-9]{1,5}$/i.test(value.split(/[?#]/).at(0) ?? '');}
const PLACEHOLDER = /^(\$\{[^}]*\}|\{[^}]*\}|:.+|\d+)$/;
const absolutePathname = (value: string): string | null => { try { return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value).pathname : null; } catch { return null; } };
export function canonicalPath(value: string): string {
  const path = (absolutePathname(value) ?? value.split(/[?#]/).at(0) ?? '').replace(/\/{2,}/g, '/');
  const segments = path.split('/').map((segment) => (PLACEHOLDER.test(segment) ? '{}' : segment)).filter((segment) => segment !== '');
  const joined = `/${segments.join('/')}`;
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/';
}
const valueAfter = (text: string, key: RegExp): string | null => /(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(text.slice(key.exec(text)?.index ?? -1))?.[2] ?? null;
const decoratedClasses = (text: string, decorator: string): { at: number; body: string; name: string }[] => {
  const found: { at: number; body: string; name: string }[] = [];
  const pattern = new RegExp(`@${decorator}\\s*\\(`, 'g');
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    let depth = 0, close = -1;
    for (let index = match.index + match[0].length - 1; index < text.length && close < 0; index += 1) {
      const char = text.charAt(index);
      if (char === '"' || char === "'" || char === '`') { index = literalEnd(text, index) - 1; continue; }
      if (char === '(') depth += 1;
      else if (char === ')') { depth -= 1; if (depth === 0) close = index; }}
    if (close < 0) return found;
    const declaration = /^(\s*(?:export\s+)?)class\s+([A-Za-z_$][\w$]*)/.exec(text.slice(close + 1));
    if (declaration !== null) found.push({ at: close + 1 + (declaration.at(1) ?? '').length, body: text.slice(match.index + match[0].length, close), name: declaration.at(2) ?? '' });
    pattern.lastIndex = close + 1;}
  return found;};
/** Every `path:` entry of a `Routes` array; consumed by route drift and the navigation exemption. */
export function findRouteDeclarations(text: string): RouteDecl[] {
  const stripped = stripComments(text);
  const keys = [...stripped.matchAll(/\bpath\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)];
  return keys.map((key, position) => {
    const body = stripped.slice(key.index + key[0].length, keys[position + 1]?.index ?? stripped.length);
    const redirectTo = valueAfter(body, /\bredirectTo\s*:\s*/);
    const lazySpecifier = valueAfter(body, /\b(?:loadChildren|loadComponent)\s*:[\s\S]*?\bimport\s*\(\s*/);
    const kind = redirectTo !== null ? 'redirect' : key.at(2) === '**' ? 'wildcard' : lazySpecifier !== null ? 'lazy' : 'component';
    return { path: key.at(2) ?? '', kind, redirectTo, lazySpecifier, ...locate(stripped, key.index) };});}
/** Each `@Injectable` class name and line; consumed by `check:wiring` gate (a). */
export function findInjectableClasses(text: string): InjectableDecl[] {
  const stripped = stripComments(text);
  return decoratedClasses(stripped, 'Injectable').map(({ at, name }) => ({ name, line: locate(stripped, at).line }));}
/** Each `@Component` class with its selector; consumed by `check:wiring` gate (b). */
export function findComponentClasses(text: string): ComponentDecl[] {
  const stripped = stripComments(text);
  return decoratedClasses(stripped, 'Component').map(({ at, body, name }) => ({ name, selector: valueAfter(body, /\bselector\s*:\s*/), line: locate(stripped, at).line }));}
/** True when a spec holds a real assertion; a commented-out `expect` must not count. */
export function hasExpect(text: string): boolean { return /\bexpect\s*[.(]/.test(stripComments(text)); }
