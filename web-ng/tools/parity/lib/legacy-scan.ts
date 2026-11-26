/// <reference types="node" />
import { stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { readText, repoRoot, stripComments, walk } from './source-scan.js';
/** State of the read-only legacy tree, this folder's only `app/` contact; consumed by `check:templates` (criterion 6). */
export type LegacyTree = { present: true; scriptsRoot: string; viewsRoot: string | null } | { present: false; reason: string; checked: string[] };
/** One legacy `template` call site; consumed by `check:templates` for the legacy cross-check of criterion 6. */
export interface LegacyTemplateCall { file: string; line: number; resource: string; detail: string }
const SCRIPTS_ROOT: string = join(repoRoot, 'app', 'scripts');
const VIEWS_ROOT: string = join(repoRoot, 'app', 'views');
const describe = (error: unknown): string => {
  const code: unknown = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return (typeof code === 'string' ? code + ': ' : '') + (error instanceof Error ? error.message : String(error));};
/** Probes the legacy tree; consumed by `check:templates` for the cross-check and its LEGACY TREE ABSENT note. */
export async function scanLegacyTree(): Promise<LegacyTree> {
  try {
    await stat(SCRIPTS_ROOT);} catch (error) {
    return { present: false, checked: [SCRIPTS_ROOT, VIEWS_ROOT], reason: 'legacy tree absent: ' + SCRIPTS_ROOT + ' is not readable (' + describe(error) + '), so the legacy template cross-check is skipped; restore the legacy app/ checkout (this base commit ships only README.md) to enable it' };
  }
  const viewsVisible: boolean = await stat(VIEWS_ROOT).then((entry) => entry.isDirectory(), () => false);
  return { present: true, scriptsRoot: SCRIPTS_ROOT, viewsRoot: viewsVisible ? VIEWS_ROOT : null };}
/** One resource the legacy factory declares, with the endpoint path it performs its call on; consumed by `check:templates`. */
export interface LegacyResourcePath {
  /** Property name of the resource on the legacy factory, e.g. `clientResource`. */
  name: string;
  /** Path the declaration hands to `defineResource`, api version prefix excluded and placeholders intact. */
  path: string;}
/** A `name: defineResource(apiVer + "<path>"` declaration; the backreference keeps the quote the path opened with. */
const RESOURCE_DECLARATION = /([A-Za-z_$][\w$]*)\s*:\s*defineResource\(\s*apiVer\s*\+\s*(["'])([^"']*)\2/g;
/** Every resource the legacy factory declares, each with the path it performs its call on; `null` when that factory cannot be read, because an unreadable factory must never pass for one with no resources. */
export async function findLegacyResourcePaths(tree: LegacyTree): Promise<LegacyResourcePath[] | null> {
  if (!tree.present) return [];
  let text: string;
  try {
    text = await readText(join(tree.scriptsRoot, 'services', 'ResourceFactoryProvider.js'));} catch {
    return null;}
  const paths = new Map<string, string>();
  for (const match of text.matchAll(RESOURCE_DECLARATION)) {
    const name: string = match.at(1) ?? '';
    if (name !== '' && !paths.has(name)) paths.set(name, match.at(3) ?? '');}
  return [...paths].map(([name, path]) => ({ name, path }));}
const controllerFiles = (scriptsRoot: string): Promise<string[]> => walk(join(scriptsRoot, 'controllers'), { extensions: ['.js'] });
/** Absolute paths of the legacy controller sources; consumed by `check:templates` through `findLegacyTemplateCalls`. */
export async function listLegacyControllerFiles(): Promise<string[]> {
  const tree: LegacyTree = await scanLegacyTree();
  return tree.present ? controllerFiles(tree.scriptsRoot) : [];}
const RESOURCE = /\b\w*[Tt]emplate\w*Resource\b/g;
const RECEIVER = /([A-Za-z_$][\w$]*)\s*\./g;
const PATTERNS: readonly { pattern: RegExp; namesResource: boolean }[] = [{ pattern: RESOURCE, namesResource: true }, { pattern: /\.template\b/g, namesResource: false }, { pattern: /\btemplateType\b/g, namesResource: false }, { pattern: /\bcommandParam\b/g, namesResource: false }, { pattern: /\btemplate\s*[:=]\s*true\b/g, namesResource: false },
];
const describeMatch = (text: string, at: number, token: string, names: boolean): Omit<LegacyTemplateCall, 'file'> => {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  const line = text.slice(start, end < 0 ? text.length : end).replace(/\s+/g, ' ').trim();
  const from = Math.max(0, line.indexOf(token.replace(/\s+/g, ' ').trim()) - 20);
  const excerpt = line.slice(from, from + 60).trim();
  const named = [...text.slice(start, at).matchAll(RESOURCE)].at(-1)?.[0];
  return {line: text.slice(0, at).split('\n').length, detail: excerpt === '' ? token.trim() : excerpt, resource: names ? token : (named ?? [...text.slice(start, at).matchAll(RECEIVER)].at(-1)?.[1] ?? token),};
};
const scanFile = async (file: string): Promise<LegacyTemplateCall[]> => {
  const text: string = stripComments(await readText(file));
  const path: string = relative(repoRoot, file).split(sep).join('/');
  return PATTERNS.flatMap(({ pattern, namesResource }) => [...text.matchAll(pattern)].map((match) => ({ file: path, ...describeMatch(text, match.index, match[0], namesResource) })));
};
/** Every legacy template call site, sorted by file then line; consumed by `check:templates` for criterion 6 coverage. */
export async function findLegacyTemplateCalls(tree: LegacyTree): Promise<LegacyTemplateCall[]> {
  if (!tree.present) return [];
  const views: string[] = tree.viewsRoot === null ? [] : await walk(tree.viewsRoot, { extensions: ['.html'] });
  const files: string[] = [...(await controllerFiles(tree.scriptsRoot)), ...views];
  const calls: LegacyTemplateCall[] = (await Promise.all(files.map((file) => scanFile(file)))).flat();
  return calls.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) || left.line - right.line);}
