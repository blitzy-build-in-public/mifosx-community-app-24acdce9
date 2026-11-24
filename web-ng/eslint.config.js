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
 * The architectural gate is `no-restricted-imports`: `HttpClient` may be imported only by the seven
 * files that own the Fineract API surface — the six typed services plus the `core/http` interceptor —
 * so every other component and service reaches Fineract through one typed service per resource family.
 * AAP 0.14.1 sets exactly this exemption, and AAP 0.8.2 names the same seven files as the only
 * holders of Fineract URL literals in `src/`; the header of `tools/parity/check-endpoints.ts`
 * documents them too. That check enforces `endpoint-allowlist.json` over a tree-wide scan of URL
 * literals rather than this import list, so the two never have to be kept in step.
 *
 * The runtime configuration is not a Fineract caller and is not exempt: `core/config/app-config.service.ts`
 * reads the same-origin static asset `assets/config.json` with `fetch`, so it names no endpoint, owns no
 * URL and needs no `HttpClient`.
 *
 * Template accessibility rules are deliberately not enabled. These screens reproduce the
 * legacy Bootstrap 3 markup and look as they are, so the semantics they do carry — the record
 * tab strip's `role="tablist"`/`role="tab"`/`tabindex`/key handlers, the breadcrumb's
 * navigation landmark and `aria-current` — are written by hand where a control needs them,
 * rather than enforced by a blanket lint rule over markup the migration must preserve.
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
      // below — the seven URL owners — so every other file reaches Fineract through a typed service.
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
                'datatable-gate.service.ts and fineract.interceptor.ts. Every other component and ' +
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
    // The seven files that own the Fineract API surface (AAP 0.14.1, AAP 0.8.2) are the only ones
    // allowed to import HttpClient: the six typed services and the core/http interceptor that attaches
    // the auth and tenant headers. tools/parity/check-endpoints.ts documents the same seven in its header.
    files: [
      'src/app/core/auth/auth.service.ts',
      'src/app/features/clients/client.service.ts',
      'src/app/features/loans/loan.service.ts',
      'src/app/features/savings/savings.service.ts',
      'src/app/core/api/search.service.ts',
      'src/app/core/api/datatable-gate.service.ts',
      'src/app/core/http/fineract.interceptor.ts',
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
