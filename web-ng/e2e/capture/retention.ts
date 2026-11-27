/** Retention step for the parity harness: deletes the previous run's captures and parity report before a run captures anything, so the artefacts that keep client data are per-run rather than cumulative (AAP 0.10.2, AAP 0.10.4, Rule 1 clause 9). */
import { existsSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CAPTURES_DIR } from './network-capture';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** `web-ng/`, the package root every artefact must resolve inside: the capture directory and the two report files AAP 0.10.4 names all live below it, and the deletion guard refuses anything that does not (AAP 0.8.1, AAP 0.11.1). */
export const PACKAGE_ROOT_DIR: string = resolve(MODULE_DIR, '..', '..');

/** The three artefacts one run leaves behind, each resolved from this module's own location so the step finds them from any working directory: `e2e/.captures/`, which `capture/network-capture.ts` and `capture/state-snapshot.ts` write, and the `parity-report.md` plus `parity-report.json` pair AAP 0.10.4 has `npm run e2e` write at the package root (Rule 1 clause 9). */
export const RUN_ARTEFACT_PATHS: readonly string[] = [
  resolve(CAPTURES_DIR),
  resolve(PACKAGE_ROOT_DIR, 'parity-report.md'),
  resolve(PACKAGE_ROOT_DIR, 'parity-report.json'),
];

/** Whether `candidate` is a strict descendant of `packageRoot` — the test {@link purgeRunArtefacts} applies before it deletes: the package root itself, its parent and anything beside it answer `false`, so a wrong path can never delete the workspace or reach outside the checkout. */
function isInsidePackageRoot(candidate: string, packageRoot: string): boolean {
  const step = relative(packageRoot, candidate);
  return step.length > 0 && step !== '..' && !step.startsWith(`..${sep}`) && !isAbsolute(step);
}

/** Removes the per-run artefacts of a previous run, answering the targets it removed; a target outside `packageRoot` is refused with nothing deleted, an absent target is a success, and no file is opened (AAP 0.10.2, AAP 0.10.4, Rule 1 clause 9). */
export function purgeRunArtefacts(
  artefacts: readonly string[] = RUN_ARTEFACT_PATHS,
  packageRoot: string = PACKAGE_ROOT_DIR,
): readonly string[] {
  const root = resolve(packageRoot);
  const targets = artefacts.map((artefact: string): string => resolve(artefact));
  const refused = targets.filter((target: string): boolean => !isInsidePackageRoot(target, root));
  if (refused.length > 0) {
    throw new Error(`refusing to delete ${refused.join(', ')}: not inside the ${root} package root`);
  }
  const removed: string[] = [];
  for (const target of targets) {
    if (!existsSync(target)) {
      continue;
    }
    // Only file trees are deleted — no file is opened, parsed or printed, so the payloads the captures keep are never read here (Rule 1 clause 9).
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

/** The step's entry point: purges the artefacts, prints one line per artefact plus a summary, and answers the exit code — `0` when every target was removed or absent, `1` after a stderr message on refusal or failure. */
export function main(
  artefacts: readonly string[] = RUN_ARTEFACT_PATHS,
  packageRoot: string = PACKAGE_ROOT_DIR,
): number {
  let removed: readonly string[];
  try {
    removed = purgeRunArtefacts(artefacts, packageRoot);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the previous run\'s artefacts could not be removed';
    console.error(`run artefacts: ${reason}`);
    return 1;
  }
  for (const target of removed) {
    console.log(`run artefacts: removed ${target}`);
  }
  for (const target of artefacts.map((artefact: string): string => resolve(artefact))) {
    if (!removed.includes(target)) {
      console.log(`run artefacts: none at ${target}`);
    }
  }
  console.log(`run artefacts: ${removed.length} removed, ${artefacts.length - removed.length} absent (AAP 0.10.2, Rule 1 clause 9)`);
  return 0;
}

/** Runs only as the entry point — `tsx e2e/capture/retention.ts`, which `npm run e2e` calls before either front end is driven — so importing this module deletes nothing, prints nothing and throws nothing at import time (AAP 0.10.4, Rule 1 clause 9). */
const entryPoint = process.argv[1];

if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  process.exitCode = main();
}
