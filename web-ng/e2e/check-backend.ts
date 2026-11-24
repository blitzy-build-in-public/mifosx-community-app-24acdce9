/**
 * Backend provenance gate for the parity harness (AAP 0.9.4 row 11, 0.10.4; Rule 2): proves a run's
 * backend is Blitzy-Sandbox/blitzy-fineract built from source at the revision `FINERACT_COMMIT` pins,
 * and records the commit and environment the parity report header names. It reads
 * `GET /fineract-provider/actuator/info`, the server-root management endpoint owned by
 * `web-ng/tools/parity/harness-allowlist.json`; no header is sent, the body is never printed (Rule 1
 * clause 9), and the facts — endpoint reachable, remote reported, remote is the fork, commit reported,
 * and, whenever `FINERACT_COMMIT` is set, commit agrees with that pinned revision — are checked
 * separately so a failure names the missing one. The result reaches git-ignored
 * `e2e/.captures/backend-info.json`; environment: `codespaces` or `mac` (0.10.4).
 */
import { request } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from '../tools/parity/lib/cli';

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

/**
 * Detects the verification environment both harness entry points report (AAP 0.10.4): `CODESPACES`,
 * trimmed and lowercased, where unset, empty, `0` and `false` all mean the Mac and any other value
 * Codespaces. `web-ng/e2e/seed/seed.ts` calls this same function, so the gate and the seed can never
 * disagree about where a run happened (AAP 0.10.3 keeps environment differences to variables only).
 */
export function detectBackendEnvironment(): BackendEnvironment {
  const codespaces = (process.env['CODESPACES'] ?? '').trim().toLowerCase();
  return codespaces.length > 0 && codespaces !== '0' && codespaces !== 'false' ? 'codespaces' : 'mac';
}

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

/**
 * The revision this run must be backed by, or `null` when no revision is pinned: `FINERACT_COMMIT`,
 * trimmed, the value both verification environments hand in (AAP 0.10.3). An unset or blank variable
 * leaves the gate proving presence alone, so `npm run check:backend` still runs outside the Blitzy
 * environment (AAP 0.10.4).
 */
function pinnedCommit(): string | null {
  const pinned = (process.env['FINERACT_COMMIT'] ?? '').trim();
  return pinned.length > 0 ? pinned : null;
}

/**
 * Whether two commit ids name the same revision: `a` and `b` are compared case-insensitively, and an
 * abbreviated id agrees with the full id it prefixes in either direction, so a 40-character pin matches
 * a server's seven-character report and vice versa. `COMMIT_PATTERN`'s seven-character floor is what
 * keeps two different revisions from matching on a short common prefix.
 */
function namesSameCommit(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return COMMIT_PATTERN.test(shorter) && longer.startsWith(shorter);
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

/**
 * The commit id the backend reports, or `null`. Only the `git.commit.id.*` probes are read, so a
 * dependency hash or any other payload string can never satisfy the commit fact. The whole-payload
 * search survives as a last resort for a backend that nests the id where those probes do not reach,
 * and then only while `FINERACT_COMMIT` pins a revision: a payload value counts solely when it *is*
 * that pinned revision, so no unrelated hash is ever accepted (AAP 0.9.4 row 11).
 */
function readCommit(body: unknown): string | null {
  const named = ['git.commit.id.full', 'git.commit.id.abbrev', 'git.commit.id']
    .map((path) => at(body, path))
    .find((value): value is string => typeof value === 'string' && COMMIT_PATTERN.test(value.trim()));
  if (named !== undefined) return named.trim();
  const pinned = pinnedCommit();
  if (pinned === null) return null;
  return allStrings(body).map((value) => value.trim()).find((value) => namesSameCommit(value, pinned)) ?? null;
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

/**
 * Resolves provenance via Playwright's API request client, so no Chromium; self-signed TLS accepted.
 * The fork remote is always proven, and the revision too whenever `FINERACT_COMMIT` pins one, so a
 * fork built at the wrong revision fails the run instead of passing the gate that exists to catch it
 * (Rule 2, AAP 0.9.4 row 11).
 */
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
    else {
      const pinned = pinnedCommit();
      if (pinned !== null && !namesSameCommit(commit, pinned)) {
        failures.push(`the reported commit is ${commit}, not the required ${pinned} (FINERACT_COMMIT).`);
      }
    }
  }
  if (failures.length > 0 || remote === null || commit === null) throw new BackendProvenanceError(failures);
  const environment: BackendEnvironment = detectBackendEnvironment();
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

/**
 * What `--help` prints (finding 406f-F02): the one request this check makes, the artefact it writes,
 * the variables it reads — named, never valued (Rule 1 clause 9) — and how it is run.
 */
const BACKEND_USAGE: CliUsage = {
  name: 'check:backend',
  summary: 'Proves the parity run is backed by Blitzy-Sandbox/blitzy-fineract built from source, and records the commit and environment it found.',
  effects: [
    'reads GET /fineract-provider/actuator/info from the backend, the management endpoint the harness allowlist owns',
    'fails unless the reported remote is Blitzy-Sandbox/blitzy-fineract and the payload reports a commit id',
    'writes e2e/.captures/backend-info.json with the remote, commit, environment, backend address and time checked',
  ],
  environment: [
    'FINERACT_URL — base address of the backend whose provenance is proven',
    'CODESPACES — set when the run happens in Codespaces, recorded as the run environment',
  ],
  examples: [
    'npm run check:backend',
  ],
};

/** Runs the gate only as the entry point, so importing has no side effect; one line, or the error. */
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Usage is answered before the request, so `--help` proves no provenance and writes no artefact
  // (finding 406f-F02); the exit code is set, never forced, so a piped line survives.
  const intent = resolveCliIntent(BACKEND_USAGE, process.argv.slice(2));
  if (intent.kind === 'handled') {
    process.exitCode = intent.exitCode;
  } else {
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
}
