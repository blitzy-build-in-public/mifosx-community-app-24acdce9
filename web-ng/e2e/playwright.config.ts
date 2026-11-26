/** Playwright configuration for the legacy-versus-next parity suite of the new Angular front end (AAP 0.11.1 row 42, 0.8.2, 0.10.1, 0.10.4) (Rule 2, AAP 0.9.3, Rule 1 clause 9, AAP 0.10.2). */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const LEGACY_URL = process.env['LEGACY_URL'] ?? 'http://localhost:9090';
const NEXT_URL = process.env['NEXT_URL'] ?? 'http://localhost:4300';

const outputDir = fileURLToPath(new URL('../test-results', import.meta.url));
const htmlReportDir = fileURLToPath(
  new URL('../playwright-report', import.meta.url),
);

/** Failure artefacts carry no credential (Rule 1 clause 9). For every failed test Playwright writes `error-context.md` into that test's output directory and attaches it to the HTML report; unless this switch is set, the file carries a `# Page snapshot` block — an aria rendering of the live DOM in which a filled password field prints its value in clear, which both login flows here can leave behind when a submit never lands or the landing times out (AAP 0.10.1). */
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
  // Assertion timeout for both projects: placed here because Playwright 1.65 declares `expect` on the test config and on a project, not inside `use`.
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
