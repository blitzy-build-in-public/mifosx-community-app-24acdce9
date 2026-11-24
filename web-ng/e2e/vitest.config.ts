/**
 * The parity harness's own test project: `web-ng-harness`, run by `npm run test:harness`.
 *
 * Why this file exists. Until it did, nothing executed or type-checked the harness: `npm test` runs the
 * two `ng test` passes over `src/` (AAP 0.10.3 criterion 2), and `e2e/**` and `tools/**` belong to no
 * Angular project. The masking that discharges Rule 1 clause 9, the reducers that reduce a workflow's
 * Fineract end state, and the date arithmetic every comparison rests on were therefore verified by
 * review alone, and a regression in the mask would have been silent. This project is the gate that
 * fixes that: it collects the harness's own specs and reports coverage over the modules the parity
 * criterion depends on (`e2e/capture/network-capture.ts`, `e2e/capture/state-snapshot.ts` and
 * `e2e/seed/fixtures.ts`).
 *
 * Why a plain vitest project and not an `angular.json` test target. The harness is Angular-free: it is
 * Node-side Playwright tooling that never imports from `web-ng/src`, so it needs no Angular compiler, no
 * TestBed and no DOM (AAP 0.14.1 keeps the harness independent of the application's models). A vitest
 * project run by its own npm script keeps it that way, leaves `npm test` exactly the two `ng test` passes
 * AAP 0.10.3 criterion 2 fixes, and does not depend on an `angular.json` entry the harness does not own.
 *
 * Why no coverage thresholds. This project reports the coverage of the modules above; it does not gate
 * on a ratio. Coverage is a property of the tree as a whole and the harness grows file by file, so a
 * percentage floor here would fail for reasons that say nothing about the masking or the reducers — the
 * behaviour the specs pin. The two coverage gates of the plan are the `web-ng` and `web-ng-services`
 * project entries at 65% and 90% (AAP 0.10.3 criterion 2), which `npm test` enforces over `src/`.
 *
 * `root` is resolved from this file's own URL rather than from `process.cwd()`, so the include globs,
 * the coverage paths and the reported file names are identical whether the suite is started from
 * `web-ng/` or from the repository root.
 *
 * `e2e/specs/**` is excluded on purpose: those are Playwright's workflow specs (W1 to W8 and the
 * chain), owned by `e2e/playwright.config.ts`, and a vitest run must never collect them — they call
 * Playwright's own `test()` and expect a browser, a seeded backend and a legacy host.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** `web-ng/`: the parent of this file, resolved from its own URL so the project does not depend on the cwd. */
const packageRoot: string = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    name: 'web-ng-harness',
    environment: 'node',
    include: ['e2e/**/*.spec.ts'],
    exclude: ['e2e/specs/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['e2e/capture/**/*.ts', 'e2e/seed/fixtures.ts'],
      exclude: ['**/*.spec.ts'],
      reporter: ['text'],
    },
  },
});
