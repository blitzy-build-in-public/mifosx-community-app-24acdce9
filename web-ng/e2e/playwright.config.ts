/**
 * Playwright configuration for the legacy-versus-next parity suite of the new
 * Angular front end (AAP 0.11.1 row 42, 0.8.2, 0.10.1, 0.10.4).
 *
 * One spec set runs twice: project `legacy` drives the unchanged AngularJS app
 * and project `next` drives this application, so every workflow is measured
 * against its own baseline. Everything around the specs - the backend
 * provenance check, the database reset, the seed and the parity report - belongs
 * to the `npm run e2e` script, which is why this file starts no server and
 * registers no setup hook of its own.
 *
 * Environment, every variable falling back to the local Blitzy stack (Rule 2):
 *   LEGACY_URL    http://localhost:9090  legacy app     -> project `legacy`
 *   NEXT_URL      http://localhost:4300  new app        -> project `next`
 *   FINERACT_URL  https://localhost:8443 Fineract API   -> read by the page
 *                                        objects, the seed, the state snapshot
 *                                        and the backend check, never by a
 *                                        project: it is an API host, not a UI.
 *
 * Artefacts land beside the package that holds this file, in `test-results/`
 * and `playwright-report/`, resolved from this file's own location so they stay
 * put however the suite is launched. Both are git-ignored and created by
 * Playwright at run time.
 *
 * `workers: 1` with `fullyParallel: false`, and the `legacy` project ordered
 * ahead of `next`, are required rather than stylistic (AAP 0.9.3, 0.10.1): a run
 * starts from a freshly seeded database whose seed is deliberately
 * non-idempotent, so two workflows must never interleave against one backend,
 * and the legacy baseline has to be recorded before the new app is judged.
 *
 * `retries: 0` is deliberate: a retry would hide exactly the behavioural
 * difference the parity report exists to expose.
 *
 * Tracing is deliberately `off`. A Playwright trace is a second, unmasked
 * network log: it records every request's headers and post data, so a retained
 * trace would keep the `Authorization: Basic <key>` header of every Fineract
 * call and the `POST /authentication` body's password in clear, which Rule 1
 * clause 9 forbids writing to test output. The harness's evidence path is the
 * capture that masks those values as it records them (AAP 0.10.2) and the record
 * attached to each workflow, so no trace is needed. Failure output is closed
 * against the same leak from the other side too: the DOM page snapshot
 * Playwright would otherwise render into `error-context.md` is switched off at
 * module scope below, so no field value - a filled password included - can reach
 * that file. No browser session state is configured here either; both
 * applications authenticate through their own login screens.
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * UI under test for each project. Both default to the local stack, so the suite
 * can be listed and run with no environment configured at all.
 */
const LEGACY_URL = process.env['LEGACY_URL'] ?? 'http://localhost:9090';
const NEXT_URL = process.env['NEXT_URL'] ?? 'http://localhost:4300';

/**
 * Absolute artefact locations, anchored at the package root above `e2e/`.
 */
const outputDir = fileURLToPath(new URL('../test-results', import.meta.url));
const htmlReportDir = fileURLToPath(
  new URL('../playwright-report', import.meta.url),
);

/**
 * Failure artefacts carry no credential (Rule 1 clause 9). For every failed test
 * Playwright writes `error-context.md` into that test's output directory and
 * attaches it to the HTML report; unless this switch is set, the file carries a
 * `# Page snapshot` block - an aria rendering of the live DOM in which a filled
 * password field prints its value in clear, which both login flows here can
 * leave behind when a submit never lands or the landing times out.
 * `PLAYWRIGHT_NO_COPY_PROMPT` is the environment variable Playwright itself
 * reads to skip that snapshot (`playwright/lib/index.js`, `_takePageSnapshot`),
 * so setting it at module scope - before `defineConfig` runs, in the process
 * that writes the file - removes the block for every run of this config. The
 * masked capture, the workflow record and the failure screenshot remain the
 * evidence path (AAP 0.10.1, 0.10.2).
 */
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',
  outputDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  // Assertion timeout for both projects: placed here because Playwright 1.65
  // declares `expect` on the test config and on a project, not inside `use`.
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: htmlReportDir, open: 'never' }]],
  use: {
    // Fineract on 8443 serves a self-signed certificate; the API is local.
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'legacy', use: { baseURL: LEGACY_URL } },
    { name: 'next', use: { baseURL: NEXT_URL } },
  ],
});
