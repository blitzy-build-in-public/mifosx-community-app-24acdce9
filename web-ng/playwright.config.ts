/** Package-root entry point for the parity suite, so the proof command `npx playwright test --list` run from `web-ng/` (AAP 0.10.3) finds the e2e specs instead of defaulting `testDir` to the whole package and collecting the vitest specs beside them. The suite stays configured once, in `e2e/playwright.config.ts`, which `npm run e2e` still passes by path; only `testDir` is restated here, because Playwright resolves a relative `testDir` against the directory of the config file that declares it. */
import shared from './e2e/playwright.config';

export default { ...shared, testDir: './e2e/specs' };
