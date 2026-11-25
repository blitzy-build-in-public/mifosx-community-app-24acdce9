/**
 * The harness's own test for the seed artefact's failure contract (`e2e/seed/seed.ts`) — the one
 * behaviour of the seed a spec can pin without a backend.
 *
 * Why this file exists. The artefact `web-ng/e2e/.captures/seed.json` states "what one seed run
 * produced", so a spec or a tool that reads it after a failed run must not receive a previous run's ids
 * and `runDate`: on a recreated database those ids name records that no longer exist, so a seed failure
 * would surface downstream as an unrelated missing-record error. The fix is that every run removes the
 * artefact before it makes its first request, and that removal is a single filesystem call — testable
 * with no backend, no browser and no credentials. A regression that moved the removal behind a request,
 * or dropped it, fails here instead of in a manual run.
 *
 * {@link discardResultArtefact} is the module's own export, so nothing is re-implemented: the marker is
 * written at the artefact's real path and removed by the same function `runSeed` calls first.
 *
 * These are the harness's tests, not the Playwright workflow specs: they run under the `web-ng-harness`
 * vitest project (`e2e/vitest.config.ts`, `npm run test:harness`) in a plain Node environment.
 */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discardResultArtefact } from './seed';

/**
 * The artefact's real path, resolved from this file's URL exactly as `seed.ts` resolves it. Resolving it
 * here independently is what proves the module and a consumer name the same file.
 */
const ARTEFACT_PATH: string = fileURLToPath(new URL('../.captures/seed.json', import.meta.url));

/**
 * A previous run's artefact, shaped like the one the finding left behind: a `runDate` and an id that no
 * recreated database holds, so reading it after a failed run is exactly the hazard being pinned.
 */
const STALE_ARTEFACT: string = `${JSON.stringify(
  {
    runDate: '2020-01-01',
    staff: { id: -999 },
    note: 'STALE-MARKER-FROM-A-PREVIOUS-RUN',
  },
  null,
  2,
)}\n`;

/**
 * Whether a file is readable at `path` — the question a consumer of the artefact asks, and the one the
 * removal has to answer with "no".
 */
async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('discardResultArtefact', () => {
  it('removes the artefact a previous run left, which the run clears before its first request', async () => {
    await mkdir(dirname(ARTEFACT_PATH), { recursive: true });
    await writeFile(ARTEFACT_PATH, STALE_ARTEFACT, 'utf8');
    expect(await isReadable(ARTEFACT_PATH)).toBe(true);

    await discardResultArtefact();

    expect(await isReadable(ARTEFACT_PATH)).toBe(false);
  });

  it('succeeds and leaves no artefact when there was none to remove', async () => {
    await rm(ARTEFACT_PATH, { force: true });

    await discardResultArtefact();

    expect(await isReadable(ARTEFACT_PATH)).toBe(false);
  });
});
