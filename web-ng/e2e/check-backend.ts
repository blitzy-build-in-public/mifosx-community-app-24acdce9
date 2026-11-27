/** Backend provenance gate for the parity harness (AAP 0.9.4 row 11, 0.10.4; Rule 2): proves a run's backend is Blitzy-Sandbox/blitzy-fineract built from source at the revision `FINERACT_COMMIT` pins, by reading `GET (Rule 1 clause 9). */
import { request } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliIntent, type CliUsage } from '../tools/parity/lib/cli';
import { FINERACT_URL } from './seed/fixtures';
/** Where the run happened; the report header names it (AAP 0.10.4). */
export type BackendEnvironment = 'mac' | 'codespaces';
export interface BackendInfo {
  remote: string; commit: string; environment: BackendEnvironment;
  fineractUrl: string; checkedAt: string;
}
/** Server root of the backend this gate proves, resolved once in `seed/fixtures.ts` (`FINERACT_URL`, else the locally built Fineract, trailing slashes stripped) so the address recorded is the address the seed, the state snapshot and the page objects compose (Rule 2). */
export { FINERACT_URL };
// The only repository a run may be backed by, the harness-owned endpoint (harness-allowlist.json only), the commit-id shape, and the git-ignored artefact.
const REQUIRED_REMOTE = 'Blitzy-Sandbox/blitzy-fineract';
const INFO_PATH = '/fineract-provider/actuator/info';
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const BACKEND_INFO_PATH = fileURLToPath(new URL('.captures/backend-info.json', import.meta.url));
/** Detects the verification environment both harness entry points report (AAP 0.10.4): `CODESPACES` unset, empty, `0` or `false` means the Mac, anything else Codespaces — the same function the seed calls, so gate and seed cannot disagree. */
export function detectBackendEnvironment(): BackendEnvironment {
  const codespaces = (process.env['CODESPACES'] ?? '').trim().toLowerCase();
  return codespaces.length > 0 && codespaces !== '0' && codespaces !== 'false' ? 'codespaces' : 'mac';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}
function allStrings(body: unknown): string[] {
  return (JSON.stringify(body) ?? '').match(/"[^"]*"/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];
}
/** The revision this run must be backed by, or `null` when none is pinned: a blank `FINERACT_COMMIT` leaves the gate proving presence alone, so it still runs outside the Blitzy environment (AAP 0.10.4). */
function pinnedCommit(): string | null {
  const pinned = (process.env['FINERACT_COMMIT'] ?? '').trim();
  return pinned.length > 0 ? pinned : null;
}
/** Whether two commit ids name the same revision: case-insensitive, an abbreviated id agreeing with the id it prefixes either way, `COMMIT_PATTERN`'s seven-character floor keeping two different revisions apart. */
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
/** The commit id the backend reports, or `null`: only the `git.commit.id.*` probes count, so a dependency hash cannot satisfy the fact; the whole-payload search is a last resort and then only for the pinned revision (AAP 0.9.4 row 11). */
function readCommit(body: unknown): string | null {
  const named = ['git.commit.id.full', 'git.commit.id.abbrev', 'git.commit.id']
    .map((path) => at(body, path))
    .find((value): value is string => typeof value === 'string' && COMMIT_PATTERN.test(value.trim()));
  if (named !== undefined) return named.trim();
  const pinned = pinnedCommit();
  if (pinned === null) return null;
  return allStrings(body).map((value) => value.trim()).find((value) => namesSameCommit(value, pinned)) ?? null;
}
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

/** Resolves provenance via Playwright's API request client, so no Chromium; self-signed TLS accepted (Rule 2, AAP 0.9.4). */
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
    return complete ? ({ remote, commit, environment, fineractUrl, checkedAt } as BackendInfo) : null;
  } catch {
    return null;
  }
}

/** What `--help` prints: the one request this check makes, the artefact it writes, the variables it reads — named, never valued (Rule 1 clause 9) — and how it is run. */
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

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Usage is answered before the request, so `--help` proves no provenance and writes no artefact; the exit code is set, never forced, so a piped line survives.
  const intent = resolveCliIntent(BACKEND_USAGE, process.argv.slice(2));
  if (intent.kind === 'handled') {
    process.exitCode = intent.exitCode;
  } else {
    try {
      const info = await resolveBackendInfo();
      writeBackendInfo(info);
      console.log(`backend: ${info.remote} @ ${info.commit.slice(0, 7)} (environment: ${info.environment} via ${info.fineractUrl})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
