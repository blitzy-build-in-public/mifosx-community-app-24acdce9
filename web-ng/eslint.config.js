/** ESLint flat configuration for the web-ng Angular application, loaded by `ng lint` (AAP 0.14.1, AAP 0.8.2, Rule 1 clause 3, AAP 0.10.5). */
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
      // Architectural gate: an error, never a warning. The only relaxation is the exemption list below — the seven URL owners — so every other file reaches Fineract through a typed service.
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
    // The seven files that own the Fineract API surface (AAP 0.14.1, AAP 0.8.2) are the only ones allowed to import HttpClient: the six typed services and the core/http interceptor that attaches the auth and tenant headers..
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
