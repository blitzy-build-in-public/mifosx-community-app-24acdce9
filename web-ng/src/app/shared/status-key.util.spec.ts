import { describe, expect, it } from 'vitest';

import { STATUS_KEYS, normaliseStatusCode, toStatusKey, type StatusKey } from './status-key.util';

/**
 * Behaviour of the one status vocabulary the whole application shares, and of the single mapping
 * from a Fineract status code onto it (AAP 0.2.3 component inventory row `StatusSwatch`; AAP 0.7.2
 * rows `Client`, `ClientAccountSummary`, `LoanAccount`, `SavingsAccount`; AAP 0.14.1 "One direction
 * of dependency"; Rule 1 clause 8).
 *
 * What it proves is the contract the three families and the global search screen now depend on on
 * their own: every code the fork's `ClientStatus.java`, `LoanStatus.java` and
 * `SavingsAccountStatusType.java` enums send reaches the key the design paints for it, the one
 * normalisation reduces each family's spelling of a state to the same name, and every state the
 * four-key vocabulary has no colour for — the two transfers, an invalid record, an overpaid loan on
 * the surfaces that keep it neutral — plus a missing or unknown code stays the neutral `other`
 * rather than claiming a state.
 *
 * The codes are the fork's own enum values and the keys are the ones the legacy status classes in
 * `web-ng/src/styles.scss` paint; neither is invented here, and no fixture reproduces shipped data
 * (Rule 1 clauses 6 and 9).
 */

/**
 * Every status code of the three families, paired with the indicator key it must paint: the
 * complete `ClientStatus.java` enumeration, the complete `LoanStatus.java` enumeration and the
 * complete `SavingsAccountStatusType.java` enumeration. Every terminal state is listed separately
 * although they share one colour, so a table that dropped one of them fails here instead of
 * silently painting that record neutral.
 */
const STATUS_CASES: readonly (readonly [string, StatusKey])[] = [
  ['clientStatusType.active', 'active'],
  ['clientStatusType.pending', 'pending'],
  ['clientStatusType.closed', 'closed'],
  ['clientStatusType.rejected', 'closed'],
  ['clientStatusType.withdraw', 'closed'],
  ['loanStatusType.submitted.and.pending.approval', 'pending'],
  ['loanStatusType.approved', 'pending'],
  ['loanStatusType.active', 'active'],
  ['loanStatusType.withdrawn.by.client', 'closed'],
  ['loanStatusType.rejected', 'closed'],
  ['loanStatusType.closed.obligations.met', 'closed'],
  ['loanStatusType.closed.written.off', 'closed'],
  ['loanStatusType.closed.reschedule.outstanding.amount', 'closed'],
  ['savingsAccountStatusType.submitted.and.pending.approval', 'pending'],
  ['savingsAccountStatusType.approved', 'pending'],
  ['savingsAccountStatusType.active', 'active'],
  ['savingsAccountStatusType.withdrawn.by.applicant', 'closed'],
  ['savingsAccountStatusType.rejected', 'closed'],
  ['savingsAccountStatusType.closed', 'closed'],
  ['savingsAccountStatusType.pre.mature.closure', 'closed'],
  ['savingsAccountStatusType.matured', 'closed'],
];

/**
 * The codes the mapping must leave neutral, labelled for the test's own message: the transitions
 * this four-key vocabulary paints no colour of its own for, an invalid record, an overpaid loan —
 * which only the loan record colours, through its own table — an empty code, and a code no enum
 * declares.
 */
const NEUTRAL_CASES: readonly (readonly [string, string | undefined])[] = [
  ['an invalid client record', 'clientStatusType.invalid'],
  ['a client transfer in progress', 'clientStatusType.transfer.in.progress'],
  ['a client transfer on hold', 'clientStatusType.transfer.on.hold'],
  ['a loan transfer in progress', 'loanStatusType.transfer.in.progress'],
  ['a savings transfer on hold', 'savingsAccountStatusType.transfer.on.hold'],
  ['an overpaid loan', 'loanStatusType.overpaid'],
  ['a code no enum declares', 'clientStatusType.notAStateYet'],
  ['an empty code', ''],
  ['a status the payload omitted', undefined],
];

/**
 * The one normalisation, in the spellings the three families and the payloads actually produce: an
 * upper-cased message code with its family prefix, a multi-word code whose separators are dots, a
 * camel-cased code with no prefix at all, and a code whose separators are underscores.
 */
const NORMALISATION_CASES: readonly (readonly [string, string])[] = [
  ['CLIENTSTATUSTYPE.ACTIVE', 'active'],
  ['loanStatusType.closed.written.off', 'closedwrittenoff'],
  ['preMatureClosure', 'prematureclosure'],
  ['SAVINGSACCOUNTSTATUSTYPE.ACTIVE', 'active'],
  ['submittedAndPendingApproval', 'submittedandpendingapproval'],
  ['closed_written_off', 'closedwrittenoff'],
];

/**
 * The same four spellings as keys, which is what the normalisation is for: a family prefix, a
 * different case and a different separator all have to reach the colour the canonical code reaches.
 */
const SPELLING_CASES: readonly (readonly [string, StatusKey])[] = [
  ['CLIENTSTATUSTYPE.ACTIVE', 'active'],
  ['loanStatusType.closed.written.off', 'closed'],
  ['preMatureClosure', 'closed'],
  ['SAVINGSACCOUNTSTATUSTYPE.ACTIVE', 'active'],
];

describe('toStatusKey', () => {
  it.each(STATUS_CASES)('maps %s to the indicator key %s', (code: string, key: StatusKey) => {
    expect(toStatusKey(code)).toBe(key);

    // Whatever a family sends, the answer is a key the indicator accepts.
    expect(STATUS_KEYS.has(toStatusKey(code))).toBe(true);
  });

  it.each(NEUTRAL_CASES)('keeps %s neutral rather than claiming a state', (_label, code) => {
    expect(toStatusKey(code)).toBe('other');

    expect(STATUS_KEYS.has(toStatusKey(code))).toBe(true);
  });

  it.each(SPELLING_CASES)(
    'reads %s as the key %s whatever its prefix, case or separators',
    (code: string, key: StatusKey) => {
      expect(toStatusKey(code)).toBe(key);
    },
  );
});

describe('normaliseStatusCode', () => {
  it.each(NORMALISATION_CASES)('reduces %s to %s before the lookup', (code, normalised) => {
    expect(normaliseStatusCode(code)).toBe(normalised);
  });
});

describe('STATUS_KEYS', () => {
  it('holds exactly the four keys the design vocabulary declares, and nothing else', () => {
    expect(STATUS_KEYS.size).toBe(4);

    expect([...STATUS_KEYS].sort()).toEqual(['active', 'closed', 'other', 'pending']);
  });
});
