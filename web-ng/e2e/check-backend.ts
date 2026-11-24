/**
 * Backend provenance gate for the parity harness (AAP 0.9.4 row 11, 0.10.4; Rule 2): proves a run's
 * backend is Blitzy-Sandbox/blitzy-fineract built from source, and records the commit and environment
 * the parity report header names. It reads `GET /fineract-provider/actuator/info`, the server-root
 * management endpoint owned by `web-ng/tools/parity/harness-allowlist.json`; no header is sent, the body
 * is never printed (Rule 1 clause 9), and the four facts — endpoint reachable, remote reported, remote
 * is the fork, commit reported — are checked separately so a failure names the missing one. The result
 * reaches git-ignored `e2e/.captures/backend-info.json`; environment: `codespaces` or `mac` (0.10.4).
 */
import { request } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the run happened; the report header names it (AAP 0.10.4). */
export type BackendEnvironment = 'mac' | 'codespaces';
/** Provenance of the backend under test: the report header's backend row and the check's own time. */
export interface BackendInfo {
  remote: string; commit: string; environment: BackendEnvironment;
  fineractUrl: string; checkedAt: string;
}

/** Server root of the backend: `FINERACT_URL`, or the locally built Fineract on 8443 (Rule 2). */
export const FINERACT_URL: string = process.env['FINERACT_URL'] ?? 'https://localhost:8443';
// The only repository a run may be backed by, the harness-owned endpoint (in harness-allowlist.json
// only, because the application never calls it), the commit-id shape, and the git-ignored artefact.
const REQUIRED_REMOTE = 'Blitzy-Sandbox/blitzy-fineract';
const INFO_PATH = '/fineract-provider/actuator/info';
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const BACKEND_INFO_PATH = fileURLToPath(new URL('.captures/backend-info.json', import.meta.url));

/** Narrows a JSON object; `Array.isArray` alone would leave array elements loosely typed. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a dotted field path, answering `undefined` wherever the payload along the way is no object. */
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}

/** Every string the payload holds, so a shape the named probes do not reach is still searched. */
function allStrings(body: unknown): string[] {
  return (JSON.stringify(body) ?? '').match(/"[^"]*"/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];
}

/** The remote the backend was built from as `owner/name`, probed from Spring's unmodelled info map. */
function readRemote(body: unknown): string | null {
  const reported: unknown =
    at(body, 'git.remote.origin.url') ??
    at(body, 'git.remote.url') ??
    at(body, 'build.remote') ??
    allStrings(body).find((text) => /blitzy-fineract/i.test(text));
  if (typeof reported !== 'string') return null;
  return reported.replace(/^git@[^:]+:/, '').replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+\//i, '')
    .replace(/\/+$/, '').replace(/\.git$/i, '').trim();
}

/** The commit id the backend reports, or `null`; a build version counts only when it is really an id. */
function readCommit(body: unknown): string | null {
  const reported: readonly unknown[] = [
    at(body, 'git.commit.id.full'),
    at(body, 'git.commit.id.abbrev'),
    at(body, 'git.commit.id'),
    at(body, 'build.version'),
    ...allStrings(body),
  ];
  const ids = reported.filter((value): value is string => typeof value === 'string');
  return ids.map((value) => value.trim()).find((value) => COMMIT_PATTERN.test(value)) ?? null;
}

/** Raised when provenance cannot be proven; the message lists every failed fact and the human's fix. */
export class BackendProvenanceError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`Backend provenance check failed for ${FINERACT_URL}:\n- ${failures.join('\n- ')}\n` +
      `Only ${REQUIRED_REMOTE} built from source may back a run, never a downloaded or upstream image ` +
      `(Rule 2). Fix: clone the ${REQUIRED_REMOTE} repository, build the image with ` +
      '`./gradlew :fineract-provider:jibDockerBuild -x test`, then restart the stack with ' +
      '`docker compose -f docker-compose-postgresql.yml up -d --pull never`.');
    this.name = 'BackendProvenanceError';
  }
}

/** Resolves provenance via Playwright's API request client, so no Chromium; self-signed TLS accepted. */
export async function resolveBackendInfo(): Promise<BackendInfo> {
  const failures: string[] = [];
  let remote: string | null = null;
  let commit: string | null = null;
  const context = await request.newContext({ baseURL: FINERACT_URL, ignoreHTTPSErrors: true });
  try {
    const response = await context.get(INFO_PATH);
    if (response.status() !== 200) failures.push(`the endpoint answered HTTP ${response.status()}, not 200.`);
    else {
      const body: unknown = await response.json();
      remote = readRemote(body);
      commit = readCommit(body);
    }
  } catch (error) {
    failures.push(`the endpoint could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.dispose();
  }
  if (failures.length === 0) {
    if (remote === null) failures.push('the endpoint reported no Git remote, so its source is unproven.');
    else if (remote.toLowerCase() !== REQUIRED_REMOTE.toLowerCase()) {
      failures.push(`the reported remote is ${remote}, not ${REQUIRED_REMOTE}.`);
    }
    if (commit === null) failures.push('the endpoint reported no commit id, so its revision is unproven.');
  }
  if (failures.length > 0 || remote === null || commit === null) throw new BackendProvenanceError(failures);
  const environment: BackendEnvironment = process.env['CODESPACES'] ? 'codespaces' : 'mac';
  return { remote, commit, environment, fineractUrl: FINERACT_URL, checkedAt: new Date().toISOString() };
}

/** Persists what the check proved, so the report header needs no second API call (AAP 0.10.4). */
export function writeBackendInfo(info: BackendInfo): void {
  mkdirSync(dirname(BACKEND_INFO_PATH), { recursive: true });
  writeFileSync(BACKEND_INFO_PATH, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

/** The recorded artefact, or `null` when absent, unparseable or incomplete (AAP 0.10.4). */
export function readBackendInfo(): BackendInfo | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(BACKEND_INFO_PATH, 'utf8'));
    if (!isRecord(parsed)) return null;
    const { remote, commit, environment, fineractUrl, checkedAt } = parsed;
    const complete = typeof remote === 'string' && typeof commit === 'string' && typeof fineractUrl === 'string'
      && typeof checkedAt === 'string' && (environment === 'mac' || environment === 'codespaces');
    // The fields are proven complete above; the cast only re-attaches the shape JSON parsing dropped.
    return complete ? ({ remote, commit, environment, fineractUrl, checkedAt } as BackendInfo) : null;
  } catch {
    return null;
  }
}

/** Runs the gate only as the entry point, so importing has no side effect; one line, or the error. */
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const info = await resolveBackendInfo();
    writeBackendInfo(info);
    console.log(`backend: ${info.remote} @ ${info.commit.slice(0, 7)} (environment: ${info.environment} via ${info.fineractUrl})`);
  } catch (error) {
    // Exit codes are set rather than forced, so a piped summary line is never lost to process.exit().
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
