/**
 * ESLint flat configuration for the web-ng Angular application, loaded by `ng lint`.
 *
 * Only the lint packages pinned in package.json are in play: `eslint` runs the config and
 * the two packages imported below, `typescript-eslint` and `angular-eslint`, supply it.
 *
 * Linting is deliberately not type-aware. The lint gate must exit 0, no rule below needs
 * type information, and type checking is `npm run build`'s job: enabling
 * `parserOptions.project` / `projectService` would require every linted file to belong to
 * one of the tsconfig projects, which spec files and plain helpers do not share.
 *
 * The architectural gate is `no-restricted-imports`: `HttpClient` may be imported only by
 * the files that own the Fineract API surface, so every other component and service reaches
 * Fineract through one typed service per resource family. The same seven paths are the only
 * URL owners recognised by tools/parity/check-wiring.ts and check-endpoints.ts, so the
 * exemption list below must stay identical to theirs.
 *
 * `core/config/app-config.service.ts` is exempted alongside them for a different reason: it
 * fetches the static asset `assets/config.json` before any URL is known. That request is not a
 * Fineract API call, it owns no endpoint, and it belongs in neither parity list — but it has to go
 * through `HttpClient` to stay interceptable and testable with `HttpTestingController`.
 *
 * Template accessibility rules are deliberately not enabled. These screens reproduce the
 * legacy Bootstrap 3 markup and look as they are, and adding semantics the legacy screens
 * never carried would be the redesign the migration forbids.
 */
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.angular/**',
      'out-tsc/**',
      'parity-report.md',
      'parity-report.json',
      'e2e/.captures/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended, angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // Architectural gate: an error, never a warning. The only relaxation is the exemption list
      // below — the seven URL owners plus the config loader — so every other file reaches Fineract
      // through a typed service.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@angular/common/http',
              importNames: ['HttpClient'],
              message:
                'Inject HttpClient only in the seven Fineract URL-owning files: auth.service.ts, ' +
                'client.service.ts, loan.service.ts, savings.service.ts, search.service.ts, ' +
                'datatable-gate.service.ts, fineract.interceptor.ts, and in core/config/app-config.service.ts, ' +
                'which fetches the static assets/config.json. Every other component and ' +
                'service reaches Fineract through its typed service.',
            },
          ],
        },
      ],
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
    },
  },
  {
    // The seven files that own the Fineract API surface are the only ones allowed to import
    // HttpClient, together with core/config/app-config.service.ts, which resolves the runtime
    // configuration from the static assets/config.json before any API URL exists. Keep the seven
    // URL owners character for character in step with the parity checks.
    files: [
      'src/app/core/auth/auth.service.ts',
      'src/app/features/clients/client.service.ts',
      'src/app/features/loans/loan.service.ts',
      'src/app/features/savings/savings.service.ts',
      'src/app/core/api/search.service.ts',
      'src/app/core/api/datatable-gate.service.ts',
      'src/app/core/http/fineract.interceptor.ts',
      'src/app/core/config/app-config.service.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended],
    rules: {},
  },
);
