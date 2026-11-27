import { describe, expect, it } from 'vitest';

import { STATUS_KEYS, normaliseStatusCode, toStatusKey, type StatusKey } from './status-key.util';

/** Behaviour of the one status vocabulary the whole application shares, and of the single mapping from a Fineract status code onto it (AAP 0.2.3 `StatusSwatch` row; AAP 0.7.2 rows `Client`, `ClientAccountSummary`, `LoanAccount`, `SavingsAccount`; AAP 0.14.1 "One direction of dependency"; Rule 1 clause 8). */

const STATUS_CASES: readonly (readonly [string, StatusKey])[] = [['clientStatusType.active', 'active'],
  ['clientStatusType.pending', 'pending'], ['clientStatusType.closed', 'closed'], ['clientStatusType.rejected', 'rejected'],
  ['clientStatusType.withdraw', 'withdrawn'], ['loanStatusType.submitted.and.pending.approval', 'pending'],
  ['loanStatusType.approved', 'pending'], ['loanStatusType.active', 'active'], ['loanStatusType.withdrawn.by.client', 'withdrawn'],
  ['loanStatusType.rejected', 'rejected'], ['loanStatusType.closed.obligations.met', 'closed'],
  ['loanStatusType.closed.written.off', 'closed'], ['loanStatusType.closed.reschedule.outstanding.amount', 'closed'],
  ['savingsAccountStatusType.submitted.and.pending.approval', 'pending'], ['savingsAccountStatusType.approved', 'pending'],
  ['savingsAccountStatusType.active', 'active'], ['savingsAccountStatusType.withdrawn.by.applicant', 'withdrawn'],
  ['savingsAccountStatusType.rejected', 'rejected'], ['savingsAccountStatusType.closed', 'closed'],
  ['savingsAccountStatusType.pre.mature.closure', 'closed'], ['savingsAccountStatusType.matured', 'closed'], ];

/** The codes the mapping must leave neutral, labelled for the test's own message: the transitions this vocabulary paints no colour of its own for, an invalid record, an overpaid loan — which only the loan record colours, through its own table — an empty code, and a code no enum declares. A rejected or withdrawn record is deliberately not here: each reaches a key of its own, which the table above asserts. */
const NEUTRAL_CASES: readonly (readonly [string, string | undefined])[] = [['an invalid client record', 'clientStatusType.invalid'],
  ['a client transfer in progress', 'clientStatusType.transfer.in.progress'],
  ['a client transfer on hold', 'clientStatusType.transfer.on.hold'],
  ['a loan transfer in progress', 'loanStatusType.transfer.in.progress'],
  ['a savings transfer on hold', 'savingsAccountStatusType.transfer.on.hold'], ['an overpaid loan', 'loanStatusType.overpaid'],
  ['a code no enum declares', 'clientStatusType.notAStateYet'], ['an empty code', ''], ['a status the payload omitted', undefined], ];

const NORMALISATION_CASES: readonly (readonly [string, string])[] = [['CLIENTSTATUSTYPE.ACTIVE', 'active'],
  ['loanStatusType.closed.written.off', 'closedwrittenoff'], ['preMatureClosure', 'prematureclosure'],
  ['SAVINGSACCOUNTSTATUSTYPE.ACTIVE', 'active'], ['submittedAndPendingApproval', 'submittedandpendingapproval'],
  ['closed_written_off', 'closedwrittenoff'], ];

const SPELLING_CASES: readonly (readonly [string, StatusKey])[] = [['CLIENTSTATUSTYPE.ACTIVE', 'active'],
  ['loanStatusType.closed.written.off', 'closed'], ['preMatureClosure', 'closed'], ['SAVINGSACCOUNTSTATUSTYPE.ACTIVE', 'active'], ];

describe('toStatusKey', () => {
  it.each(STATUS_CASES)('maps %s to the indicator key %s', (code: string, key: StatusKey) => {
    expect(toStatusKey(code)).toBe(key);

    expect(STATUS_KEYS.has(toStatusKey(code))).toBe(true);
  });

  it.each(NEUTRAL_CASES)('keeps %s neutral rather than claiming a state', (_label, code) => {
    expect(toStatusKey(code)).toBe('other');

    expect(STATUS_KEYS.has(toStatusKey(code))).toBe(true);
  });

  it.each(SPELLING_CASES)('reads %s as the key %s whatever its prefix, case or separators', (code: string, key: StatusKey) => {
      expect(toStatusKey(code)).toBe(key);
    }, );
});

/** The distinction the vocabulary exists to make on the clients list: the state its "Show Closed" checkbox hides is a different key from the states that stay visible beside it, those two are different keys from one another, and all three are legal keys of the one indicator (AAP 0.2.3 `StatusSwatch` row, AAP 0.5.4 row "Status indicator", AAP 0.7.4 "Show Closed"). */
describe('the closed, rejected and withdrawn states', () => {
  it('paint three different keys, so the state "Show Closed" hides is distinguishable from the two it keeps', () => {
    const closed = toStatusKey('clientStatusType.closed');
    const rejected = toStatusKey('clientStatusType.rejected');
    const withdrawn = toStatusKey('clientStatusType.withdraw');

    expect(closed).toBe('closed');
    expect(rejected).toBe('rejected');
    expect(withdrawn).toBe('withdrawn');

    expect(new Set([closed, rejected, withdrawn]).size).toBe(3);

    expect(STATUS_KEYS.has(closed)).toBe(true);
    expect(STATUS_KEYS.has(rejected)).toBe(true);
    expect(STATUS_KEYS.has(withdrawn)).toBe(true);
  });

  it('reach the one withdrawn key from each family’s withdrawal code and each of its spellings', () => {
    for (const code of ['clientStatusType.withdraw', 'loanStatusType.withdrawn.by.client',
      'savingsAccountStatusType.withdrawn.by.applicant', 'withdraw', 'withdrawnByClient', 'withdrawn_by_applicant']) {
      expect(toStatusKey(code), code).toBe('withdrawn');
    }
  });
});

describe('normaliseStatusCode', () => {
  it.each(NORMALISATION_CASES)('reduces %s to %s before the lookup', (code, normalised) => {
    expect(normaliseStatusCode(code)).toBe(normalised);
  });
});

describe('STATUS_KEYS', () => {
  it('holds exactly the six keys the vocabulary declares, and nothing else', () => {
    expect(STATUS_KEYS.size).toBe(6);

    expect([...STATUS_KEYS].sort()).toEqual(['active', 'closed', 'other', 'pending', 'rejected', 'withdrawn']);
  });
});
