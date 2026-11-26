/** The parity harness's own test project, `web-ng-harness`, run by `npm run test:harness` (AAP 0.10.3, Rule 1 clause 9, AAP 0.14.1). */
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
