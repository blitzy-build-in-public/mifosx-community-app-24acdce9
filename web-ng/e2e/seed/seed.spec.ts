/** The harness's own test for the seed artefact's failure contract (`e2e/seed/seed.ts`) — the one behaviour of the seed a spec can pin without a backend. */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SEED_RESULT_ARTEFACT_PATH, discardResultArtefact } from './seed';

/** The artefact's real path, resolved from this file's URL exactly as `seed.ts` resolves it. */
const ARTEFACT_PATH: string = fileURLToPath(new URL('../.captures/seed.json', import.meta.url));

/** The scratch file the stale marker goes to: this spec's own name inside the same git-ignored `.captures` directory, so the removal is exercised on a real path without overwriting — or deleting — the artefact a seed run. */
const SCRATCH_PATH: string = fileURLToPath(new URL('../.captures/seed.spec.stale.json', import.meta.url));

/** A previous run's artefact, shaped like the one the finding left behind: a `runDate` and an id that no recreated database holds, so reading it after a failed run is exactly the hazard being pinned. */
const STALE_ARTEFACT: string = `${JSON.stringify(
  {
    runDate: '2020-01-01',
    staff: { id: -999 },
    note: 'STALE-MARKER-FROM-A-PREVIOUS-RUN',
  },
  null,
  2,
)}\n`;

/** Whether a file is readable at `path` — the question a consumer of the artefact asks, and the one the removal has to answer with "no". */
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
    expect(SEED_RESULT_ARTEFACT_PATH).toBe(ARTEFACT_PATH);
    await mkdir(dirname(SCRATCH_PATH), { recursive: true });
    await writeFile(SCRATCH_PATH, STALE_ARTEFACT, 'utf8');
    expect(await isReadable(SCRATCH_PATH)).toBe(true);

    await discardResultArtefact(SCRATCH_PATH);

    expect(await isReadable(SCRATCH_PATH)).toBe(false);
  });

  it('succeeds and leaves no artefact when there was none to remove', async () => {
    await rm(SCRATCH_PATH, { force: true });

    await discardResultArtefact(SCRATCH_PATH);

    expect(await isReadable(SCRATCH_PATH)).toBe(false);
  });
});
