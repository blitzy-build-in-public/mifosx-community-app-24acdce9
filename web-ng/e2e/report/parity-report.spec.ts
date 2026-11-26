/** The harness's own tests for `e2e/report/parity-report.ts`: the gate a workflow's free text passes before it reaches `parity-report.md`, `parity-report.json` and `.captures/workflows/*.json` (Rule 2, AAP 0.3.4, AAP 0.10.1, AAP 0.10.4). */
import { describe, expect, it } from 'vitest';

import { FINERACT_URL, LEGACY_URL, NEXT_URL, TENANT_ID } from '../seed/fixtures';
import { collectProblems, redactEntryLocation, renderMarkdown, validateRecord } from './parity-report';
import type { LineBudget, ParityReport, WorkflowRecord } from './parity-report';

/** The backend address as the entry URL carries it: `encodeURIComponent` of `FINERACT_URL`. */
const ENCODED_BACKEND_URL: string = encodeURIComponent(FINERACT_URL);

const ENCODED_TENANT: string = encodeURIComponent(TENANT_ID);

/** AAP 0.10.2's mask marker, and the text every masked value must become. */
const MASK: string = '***';

/** The legacy entry URL exactly as `pages/legacy/login.page.ts` builds it — the address whose two parameter values F01 is about — before the hash a page object appends. */
const ENTRY_URL: string = `${LEGACY_URL}/?baseApiUrl=${ENCODED_BACKEND_URL}&tenantIdentifier=${ENCODED_TENANT}`;

/** The message `open()` on the legacy login page throws when neither reading of the login route renders, reproduced verbatim: it is the shape of reason every legacy-broken row carries on a host without the legacy app, and. */
const LOGIN_MESSAGE: string =
  'The legacy login form did not appear at either reading of the login route: ' +
  `${ENTRY_URL}#/login (AAP 0.8.2, the "login" route of in-scope-routes.json) or ` +
  `${ENTRY_URL} (AAP 0.2.1 Step 1, the login screen at "#/"). Check that the legacy app ` +
  'serves on LEGACY_URL and that it reached Fineract with the baseApiUrl and tenantIdentifier ' +
  'parameters these URLs carry.';

describe('parity-report entry-location redaction', () => {
  it('masks both values of every entry URL in a diagnostic and keeps the host, path, hash and sentence', () => {
    const redacted = redactEntryLocation(LOGIN_MESSAGE);

    expect(redacted).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(redacted).not.toContain(`baseApiUrl=${ENCODED_BACKEND_URL}`);
    expect(redacted).not.toContain(ENCODED_BACKEND_URL);

    const maskedEntry = `${LEGACY_URL}/?baseApiUrl=${MASK}&tenantIdentifier=${MASK}`;
    expect(redacted).toContain(`${maskedEntry}#/login`);
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

    expect(validated.workflow).toBe('W2');
    expect(validated.project).toBe('next');
    expect(validated.status).toBe('intentional-diff');
    expect(validated.intentionalDiffId).toBe(15);

    expect(validated.reason).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(validated.reason).not.toContain(ENCODED_BACKEND_URL);
    expect(validated.reason).toContain('the legacy baseline was broken at');
    expect(validated.reason).toContain('#/clients, so the new app follows the API contract');
    expect(validated.failingStep).not.toContain(`tenantIdentifier=${ENCODED_TENANT}`);
    expect(validated.failingStep).not.toContain(ENCODED_BACKEND_URL);
    expect(validated.failingStep).toContain('#/clients');

    expect(record.reason).toContain(`tenantIdentifier=${ENCODED_TENANT}`);
  });
});

describe('parity-report line budget', () => {
  /** A report as `buildReport` shapes it with only the size record varied: `workflows` empty keeps the row checks out of the way, so every assertion below is about the record alone (AAP 0.9.3, Rule 1 clause 10). */
  const reportWith = (lineBudget: LineBudget): ParityReport => ({
    header: {
      environment: 'codespaces',
      backendRemote: 'Blitzy-Sandbox/blitzy-fineract',
      backendCommit: '74099701987ccb4755706d9a3de9fbbd3576ea1b',
      fineractUrl: FINERACT_URL,
      legacyUrl: LEGACY_URL,
      nextUrl: NEXT_URL,
      runDate: '2026-11-24',
      generatedAt: '2026-11-26T00:00:00.000Z',
      backendVerified: true,
    },
    workflows: [],
    differenceRegister: [],
    lineBudget,
  });

  it('renders the measured total as the report\'s last section and names the overage only when it is over the ceiling', () => {
    const within = reportWith({ measuredLines: 58_643, measuredFiles: 245, checkScriptLines: 1_479, verdict: 'within' });
    const markdown = renderMarkdown(within);

    expect(markdown).toContain('## Line budget');
    expect(markdown).toContain('Ceiling: 60,000 generated lines');
    expect(markdown).toContain('58,643 generated lines across 245 tracked files');
    expect(markdown).toContain('git ls-files | grep -v package-lock.json | xargs wc -l');
    expect(markdown).toContain('inside the ceiling by 1,357 lines');
    expect(markdown).toContain('88,418 lines at `4a13dc7`, the commit the prose trim follows');
    expect(markdown).toContain('58,799 at `c05766d`');
    expect(markdown).toContain('the tree crossed AAP 0.9.3\'s 60,000-line ceiling while the workflow screens landed');
    expect(markdown).toContain('four fix sets landed after the cut and added 714 net lines');
    expect(markdown).toContain('taking the tree from 59,487 to 60,201 and over AAP 0.9.3\'s ceiling again');
    // The third trim: the ten fix sets that landed after the second cut, the crossing they caused and the fixed order's exhaustion.
    expect(markdown).toContain('ten fix sets landed at this checkpoint and added 2,636 net lines across 91 files');
    expect(markdown).toContain('taking the tree from 59,784 to 62,420 and over AAP 0.9.3\'s ceiling again');
    expect(markdown).toContain('the delivered tree plus them measures 63,857');
    expect(markdown).toContain('no Must scope was dropped');
    expect(markdown).toContain('1,479 lines against AAP 0.9.3\'s share of about 600');
    expect(markdown.split('\n').filter((line) => line.startsWith('## ')).pop()).toBe('## Line budget');

    expect(collectProblems(within)).toEqual([]);

    const over = reportWith({ measuredLines: 71_500, measuredFiles: 245, checkScriptLines: 1_479, verdict: 'over' });
    const problems = collectProblems(over);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('71,500 generated lines against AAP 0.9.3\'s ceiling of 60,000');
    expect(problems[0]).toContain('11,500 lines over');
  });
});

