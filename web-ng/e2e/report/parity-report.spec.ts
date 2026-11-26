/**
 * The harness's own tests for `e2e/report/parity-report.ts`: the gate a workflow's free text passes
 * before it reaches `parity-report.md`, `parity-report.json` and `.captures/workflows/*.json`.
 *
 * Why this file exists. `WorkflowRecord.reason` is whatever a page object's thrown message said, and every
 * page object opens the legacy entry URL, which carries `?baseApiUrl=<FINERACT_URL>&tenantIdentifier=
 * <TENANT_ID>` so the legacy app addresses Fineract rather than a public demo host (Rule 2; AAP 0.3.4).
 * On a host where the legacy app is not running every legacy row is `legacy-broken` with such a reason
 * (AAP 0.10.1), so without a mask the tenant value and the backend address are published into two
 * documents and one artefact on every run. AAP 0.10.4 deliberately keeps the tenant identifier outside
 * the credential gate — it is configuration, and the configured value is an ordinary English word — so
 * the credential guards can never be the fix: the value is masked on the way in, at `narrowRecord`, and
 * `assertNoCredential` refuses a document where masking was missed (Rule 1 clause 9). Nothing in
 * `npm test` reaches this module, because it is harness tooling outside the two Angular projects, so
 * until this file existed the mask was verified by review alone.
 *
 * What is pinned here: a page object's full diagnostic loses both parameter values while the host, the
 * path, the hash and the sentence around them survive (criterion 4 needs the reason readable, not
 * blank); each pair shape the harness can produce — a query pair, a URL-encoded `baseApiUrl` value, a
 * JSON-shaped quoted pair, a separator with spaces around it — is masked and everything else in the
 * string is left byte for byte; `***`, AAP 0.10.2's own mask marker, is left alone, which is what makes
 * the function idempotent and lets the fixture and the writer both apply it; prose that merely names the
 * parameters is untouched; and `validateRecord` returns the record with `reason` and `failingStep` masked
 * and `workflow`, `project`, `status` and the AAP 0.10.5 `intentionalDiffId` intact, which is the copy
 * `writeWorkflowRecord` writes.
 *
 * These are the harness's tests, not the Playwright workflow specs: they run under the `web-ng-harness`
 * vitest project (`e2e/vitest.config.ts`, `npm run test:harness`) in a plain Node environment, reach no
 * backend and write no file — `validateRecord` is the in-memory gate, and the write it feeds is not
 * exercised here. The specs that drive W1 to W8 against both front ends are Playwright's and live under
 * `e2e/specs/**`.
 *
 * Every string is built from the harness's own address and tenant constants (`e2e/seed/fixtures.ts`), the
 * same ones `pages/legacy/login.page.ts` builds the entry URL from, so no URL or tenant value is written
 * as a literal in this file (Rule 2; AAP 0.10.4's credential gate).
 */
import { describe, expect, it } from 'vitest';

import { FINERACT_URL, LEGACY_URL, TENANT_ID } from '../seed/fixtures';
import { redactEntryLocation, validateRecord } from './parity-report';
import type { WorkflowRecord } from './parity-report';

/** The backend address as the entry URL carries it: `encodeURIComponent` of `FINERACT_URL`. */
const ENCODED_BACKEND_URL: string = encodeURIComponent(FINERACT_URL);

/** The tenant as the entry URL carries it. */
const ENCODED_TENANT: string = encodeURIComponent(TENANT_ID);

/** AAP 0.10.2's mask marker, and the text every masked value must become. */
const MASK: string = '***';

/**
 * The legacy entry URL exactly as `pages/legacy/login.page.ts` builds it — the address whose two
 * parameter values F01 is about — before the hash a page object appends.
 */
const ENTRY_URL: string = `${LEGACY_URL}/?baseApiUrl=${ENCODED_BACKEND_URL}&tenantIdentifier=${ENCODED_TENANT}`;

/**
 * The message `open()` on the legacy login page throws when neither reading of the login route renders,
 * reproduced verbatim: it is the shape of reason every legacy-broken row carries on a host without the
 * legacy app, and it quotes the full entry URL twice.
 */
const LOGIN_MESSAGE: string =
  'The legacy login form did not appear at either reading of the login route: ' +
  `${ENTRY_URL}#/login (AAP 0.8.2, the "login" route of in-scope-routes.json) or ` +
  `${ENTRY_URL} (AAP 0.2.1 Step 1, the login screen at "#/"). Check that the legacy app ` +
  'serves on LEGACY_URL and that it reached Fineract with the baseApiUrl and tenantIdentifier ' +
  'parameters these URLs carry.';

describe('parity-report entry-location redaction', () => {
  it('masks both values of every entry URL in a diagnostic and keeps the host, path, hash and sentence', () => {
    const redacted = redactEntryLocation(LOGIN_MESSAGE);

    // The values are gone, in both URLs the message carries.
    expect(redacted).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(redacted).not.toContain(`baseApiUrl=${ENCODED_BACKEND_URL}`);
    expect(redacted).not.toContain(ENCODED_BACKEND_URL);

    // What makes the reason usable survives: the address, the route, the parameters' names and the prose.
    const maskedEntry = `${LEGACY_URL}/?baseApiUrl=${MASK}&tenantIdentifier=${MASK}`;
    expect(redacted).toContain(`${maskedEntry}#/login`);
    // Both occurrences are masked — the one carrying the hash and the bare one — not just the first.
    expect(redacted.split(`tenantIdentifier=${MASK}`)).toHaveLength(3);
    expect(redacted).toContain('The legacy login form did not appear at either reading of the login route');
    expect(redacted).toContain('parameters these URLs carry.');
  });

  it('is idempotent: masking text it has already masked changes nothing', () => {
    const once = redactEntryLocation(LOGIN_MESSAGE);
    expect(redactEntryLocation(once)).toBe(once);
  });

  it('leaves prose that only names the parameters alone', () => {
    const prose =
      'Check that the legacy app serves on LEGACY_URL and that it reached Fineract with the baseApiUrl '
      + 'and tenantIdentifier parameters these URLs carry, whichever host it runs on.';
    expect(redactEntryLocation(prose)).toBe(prose);
  });

  it.each([
    ['a bare query pair', `tenantIdentifier=${TENANT_ID}`, `tenantIdentifier=${MASK}`],
    [
      'an encoded baseApiUrl value',
      `?baseApiUrl=${ENCODED_BACKEND_URL}&status=500`,
      `?baseApiUrl=${MASK}&status=500`,
    ],
    ['a JSON-shaped quoted pair', `{"tenantIdentifier": "${TENANT_ID}"}`, `{"tenantIdentifier": "${MASK}"}`],
    ['a pair with spaces around the separator', `tenantIdentifier : ${TENANT_ID}`, `tenantIdentifier : ${MASK}`],
    ['a pair that is already masked', `tenantIdentifier=${MASK}`, `tenantIdentifier=${MASK}`],
    ['a quoted pair that is already masked', `{"baseApiUrl": "${MASK}"}`, `{"baseApiUrl": "${MASK}"}`],
  ])('masks only the value for %s', (_label: string, text: string, expected: string) => {
    expect(redactEntryLocation(text)).toBe(expected);
  });

  it('returns a validated record with its free text masked and every other field intact', () => {
    const record: WorkflowRecord = {
      workflow: 'W2',
      project: 'next',
      status: 'intentional-diff',
      intentionalDiffId: 15,
      reason: `the legacy baseline was broken at ${ENTRY_URL}#/clients, so the new app follows the API contract`,
      failingStep: `open ${ENTRY_URL}#/clients`,
    };

    const validated = validateRecord(record);

    // The facts the report keys on are untouched.
    expect(validated.workflow).toBe('W2');
    expect(validated.project).toBe('next');
    expect(validated.status).toBe('intentional-diff');
    expect(validated.intentionalDiffId).toBe(15);

    // Both free-text fields lose the values and keep the rest, which criterion 4 needs of a reason.
    expect(validated.reason).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(validated.reason).not.toContain(ENCODED_BACKEND_URL);
    expect(validated.reason).toContain('the legacy baseline was broken at');
    expect(validated.reason).toContain('#/clients, so the new app follows the API contract');
    expect(validated.failingStep).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(validated.failingStep).not.toContain(ENCODED_BACKEND_URL);
    expect(validated.failingStep).toContain('#/clients');

    // The argument itself is not mutated: the caller keeps the text it produced.
    expect(record.reason).toContain(`tenantIdentifier=${ENCODED_TENANT}`);
  });
});
