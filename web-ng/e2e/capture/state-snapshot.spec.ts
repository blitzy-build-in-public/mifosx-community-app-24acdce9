/** The harness's own tests for `e2e/capture/state-snapshot.ts` — the reducers that turn a workflow's Fineract end state into the small comparison-ready subset, and the diff that compares two of them: AAP 0.10.1 defines a (AAP 0.10.3, AAP 0.10.2, Rule 1 clause 8). */
import { describe, expect, it } from 'vitest';

import {
  diffStates,
  reduceClient,
  reduceLoan,
  type LoanSnapshot,
  type StateSnapshot,
} from './state-snapshot';

/** The UTC `Date` a 1-based `[year, month, day]` calendar day names, built independently of the module; the 1-based month is what every date in this file reads in, so a date cannot be mistaken for a month later than the one intended. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
const RUN_DATE = utcDay(2026, 11, 24);
/** The `status` object Fineract attaches to a client, a loan and a savings account alike. */
function status(value: string): { id: number; code: string; value: string } {
  return { id: 300, code: `statusType.${value.toLowerCase()}`, value };
}

describe('reduceClient (AAP 0.10.1 W2, W3; AAP 0.10.2)', () => {
  it('reduces status, activation, office, name and the three counts', () => {
    const snapshot = reduceClient(
      {
        displayName: 'Parity Client',
        officeId: 1,
        status: status('Active'),
        activationDate: [2026, 11, 24],
      },
      { loanAccounts: [{ id: 11 }, { id: 12 }], savingsAccounts: [{ id: 21 }] },
      [{ id: 31 }, { id: 32 }, { id: 33 }],
      RUN_DATE,
    );

    expect(snapshot).toEqual({
      status: 'Active',
      activationDateOffset: 0,
      officeId: 1,
      displayName: 'Parity Client',
      loanAccountCount: 2,
      savingsAccountCount: 1,
      identifierCount: 3,
    });
  });
  it('reads the activation date from the timeline when the top-level field is absent', () => {
    const snapshot = reduceClient(
      { status: status('Active'), timeline: { activatedOnDate: [2026, 11, 26] } },
      {}, [], RUN_DATE,
    );

    expect(snapshot.activationDateOffset).toBe(2);
  });
  it('answers an empty payload with the neutral values rather than a coerced number', () => {
    // A missing number stays `null`, never `0`: `0` is a real balance and a real count, so confusing the two would hide exactly the difference a parity comparison exists to find.
    expect(reduceClient({}, {}, [], RUN_DATE)).toEqual({
      status: '',
      activationDateOffset: null,
      officeId: null,
      displayName: '',
      loanAccountCount: 0,
      savingsAccountCount: 0,
      identifierCount: 0,
    });
  });

  it.each([
    { payload: { displayName: 'Parity Client' }, expected: 'Parity Client' },
    { payload: { firstname: 'Parity', middlename: 'Q', lastname: 'Client' }, expected: 'Parity Q Client' },
    { payload: { firstname: 'Parity', lastname: 'Client' }, expected: 'Parity Client' },
    { payload: { fullname: 'Parity Client' }, expected: 'Parity Client' },
  ])('shows $expected as the display name', ({ payload, expected }) => {
    expect(reduceClient(payload, {}, [], RUN_DATE).displayName).toBe(expected);
  });
});

describe('reduceLoan (AAP 0.10.1 W4 to W7; AAP 0.10.2)', () => {
  it('reduces status, principal, the summary and the transaction and charge counts', () => {
    const snapshot = reduceLoan({
      status: status('Active'),
      principal: 5000,
      approvedPrincipal: 5000,
      summary: { totalExpectedRepayment: 5500, totalOutstanding: 5500 },
      transactions: [{ id: 41 }],
      charges: [{ id: 51 }, { id: 52 }],
    });

    expect(snapshot).toEqual({
      status: 'Active',
      principal: 5000,
      approvedPrincipal: 5000,
      totalExpectedRepayment: 5500,
      totalOutstanding: 5500,
      firstPeriodTotalDue: null,
      transactionCount: 1,
      chargeCount: 2,
    });
  });
  it('reports a null approved principal and null money before approval', () => {
    const snapshot = reduceLoan({ status: status('Submitted'), principal: 5000 });

    expect(snapshot.approvedPrincipal).toBeNull();
    expect(snapshot.totalExpectedRepayment).toBeNull();
    expect(snapshot.totalOutstanding).toBeNull();
    expect(snapshot.firstPeriodTotalDue).toBeNull();
    expect(snapshot.transactionCount).toBe(0);
    expect(snapshot.chargeCount).toBe(0);
  });
  it('skips the leading disbursement row and takes the first numbered period', () => {
    const snapshot = reduceLoan({
      repaymentSchedule: {
        periods: [
          { period: 0, totalDue: 0 },
          { totalDueForPeriod: 0 },
          { period: 1, totalDue: 458.33 },
          { period: 2, totalDue: 458.33 },
        ],
      },
    });

    expect(snapshot.firstPeriodTotalDue).toBe(458.33);
  });
  it('falls back to totalDueForPeriod, the field this fork sends', () => {
    const snapshot = reduceLoan({
      repaymentSchedule: { periods: [{ period: 1, totalDueForPeriod: 466.67 }] },
    });

    expect(snapshot.firstPeriodTotalDue).toBe(466.67);
  });
});

describe('diffStates (AAP 0.10.1 criterion 4; AAP 0.10.2)', () => {
  const loanState: LoanSnapshot = {
    status: 'Active',
    principal: 5000,
    approvedPrincipal: 5000,
    totalExpectedRepayment: 5500,
    totalOutstanding: 5500,
    firstPeriodTotalDue: 458.33,
    transactionCount: 1,
    chargeCount: 1,
  };
  /** The legacy baseline's snapshot, the left-hand side of every comparison below. */
  const legacyState: StateSnapshot = {
    project: 'legacy',
    workflow: 'W6',
    runDate: '2026-11-24',
    loan: loanState,
  };

  it('answers no difference for two identical snapshots', () => {
    const nextState: StateSnapshot = { ...legacyState, project: 'next', workflow: 'W6' };

    expect(diffStates(legacyState, nextState)).toEqual([]);
  });
  it('reports the differing field with both sides values', () => {
    const nextState: StateSnapshot = { ...legacyState, loan: { ...loanState, totalOutstanding: 5041 } };

    expect(diffStates(legacyState, nextState)).toEqual([
      { field: 'loan.totalOutstanding', legacy: 5500, next: 5041 },
    ]);
  });
  it('ignores project, workflow and runDate, which differ between the two runs by construction', () => {
    const nextState: StateSnapshot = {
      project: 'next',
      workflow: 'CHAIN',
      runDate: '2026-11-25',
      loan: loanState,
    };

    expect(diffStates(legacyState, nextState)).toEqual([]);
  });
});
