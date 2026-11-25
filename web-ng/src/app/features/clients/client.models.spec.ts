import { describe, expect, it } from 'vitest';

import { isClosedClientStatus, toAccountStatusKey, toClientStatusKey } from './client.models';
import type { StatusKey } from '../../shared/status-key.util';

/**
 * Every status the fork's `ClientStatus` enum declares (`ClientStatus.java`), with the indicator key
 * it must paint. The list is the whole enum, so a state the table stops recognising fails here
 * rather than silently rendering the neutral colour on a client record.
 */
const STATUS_CASES: readonly { readonly code: string; readonly key: StatusKey }[] = [
  { code: 'clientStatusType.invalid', key: 'other' },
  { code: 'clientStatusType.pending', key: 'pending' },
  { code: 'clientStatusType.active', key: 'active' },
  { code: 'clientStatusType.transfer.in.progress', key: 'other' },
  { code: 'clientStatusType.transfer.on.hold', key: 'other' },
  { code: 'clientStatusType.closed', key: 'closed' },
  { code: 'clientStatusType.rejected', key: 'closed' },
  { code: 'clientStatusType.withdraw', key: 'closed' },
];

describe('toClientStatusKey', () => {
  it('paints the key of every code the ClientStatus enum declares', () => {
    for (const { code, key } of STATUS_CASES) {
      expect(toClientStatusKey(code), code).toBe(key);
    }
  });

  it('matches the whole normalised name, not one dot-segment of it', () => {
    expect(toClientStatusKey('active')).toBe('active');
    expect(toClientStatusKey('CLIENTSTATUSTYPE.ACTIVE')).toBe('active');
    expect(toClientStatusKey('clientStatusType.transfer.in.progress')).toBe('other');
  });

  it('keeps a missing or unrecognised code neutral rather than claiming a state', () => {
    expect(toClientStatusKey(undefined)).toBe('other');
    expect(toClientStatusKey('')).toBe('other');
    expect(toClientStatusKey('clientStatusType.notAStateYet')).toBe('other');
  });
});

/**
 * The clients list's "Show Closed" input, which is a different question from the swatch's colour: the
 * list hides one code, exactly as the legacy template does
 * (`ng-show="client.status.code != 'clientStatusType.closed' || showClosed"`,
 * `app/views/clients/clients.html:65`), while `toClientStatusKey` paints closed, rejected and
 * withdrawn alike.
 */
describe('isClosedClientStatus', () => {
  it('answers true for the closed code and false for every other state the client enum declares', () => {
    expect(isClosedClientStatus('clientStatusType.closed')).toBe(true);
    // The two states the colour key folds in with it stay visible on the list (Rule 1 clause 3).
    expect(isClosedClientStatus('clientStatusType.rejected')).toBe(false);
    expect(isClosedClientStatus('clientStatusType.withdraw')).toBe(false);
    expect(isClosedClientStatus('clientStatusType.active')).toBe(false);
    expect(isClosedClientStatus('clientStatusType.pending')).toBe(false);
  });

  it('normalises the code before it answers, as the colour lookup does', () => {
    expect(isClosedClientStatus('CLIENTSTATUSTYPE.CLOSED')).toBe(true);
    expect(isClosedClientStatus('closed')).toBe(true);
    expect(isClosedClientStatus('CLOSED')).toBe(true);
    expect(isClosedClientStatus('REJECTED')).toBe(false);
    expect(isClosedClientStatus('clientStatusType.transfer.in.progress')).toBe(false);
  });

  it('answers false for a code the row never carried, so nothing is hidden on a missing status', () => {
    expect(isClosedClientStatus(undefined)).toBe(false);
    expect(isClosedClientStatus('')).toBe(false);
  });
});

/**
 * Every status the fork's two account enums declare — `LoanStatus.java` for `loanStatusType.*` and
 * `SavingsAccountStatusType.java` for `savingsAccountStatusType.*` — with the indicator key the client
 * record's accounts table must paint for it, plus the transition codes it deliberately leaves neutral.
 * Both families are listed because `GET /clients/{id}/accounts` mixes them in one response, so a table
 * that recognised only one family's codes would paint the other family's rows with the neutral colour.
 */
const ACCOUNT_STATUS_CASES: readonly { readonly code: string; readonly key: StatusKey }[] = [
  { code: 'loanStatusType.active', key: 'active' },
  { code: 'savingsAccountStatusType.active', key: 'active' },
  { code: 'loanStatusType.submitted.and.pending.approval', key: 'pending' },
  { code: 'loanStatusType.approved', key: 'pending' },
  { code: 'savingsAccountStatusType.submitted.and.pending.approval', key: 'pending' },
  { code: 'savingsAccountStatusType.approved', key: 'pending' },
  { code: 'loanStatusType.closed.obligations.met', key: 'closed' },
  { code: 'loanStatusType.closed.written.off', key: 'closed' },
  { code: 'loanStatusType.closed.reschedule.outstanding.amount', key: 'closed' },
  { code: 'loanStatusType.withdrawn.by.client', key: 'closed' },
  { code: 'loanStatusType.rejected', key: 'closed' },
  { code: 'savingsAccountStatusType.closed', key: 'closed' },
  { code: 'savingsAccountStatusType.matured', key: 'closed' },
  { code: 'savingsAccountStatusType.pre.mature.closure', key: 'closed' },
  { code: 'savingsAccountStatusType.withdrawn.by.applicant', key: 'closed' },
  { code: 'savingsAccountStatusType.rejected', key: 'closed' },
  { code: 'loanStatusType.invalid', key: 'other' },
  { code: 'savingsAccountStatusType.invalid', key: 'other' },
  { code: 'loanStatusType.transfer.in.progress', key: 'other' },
  { code: 'savingsAccountStatusType.transfer.on.hold', key: 'other' },
];

describe('toAccountStatusKey', () => {
  it('paints the key of every code the two account status enums declare', () => {
    for (const { code, key } of ACCOUNT_STATUS_CASES) {
      expect(toAccountStatusKey(code), code).toBe(key);
    }
  });

  it('strips either family prefix and every separator before the lookup', () => {
    expect(toAccountStatusKey('ACTIVE')).toBe('active');
    expect(toAccountStatusKey('LOANSTATUSTYPE.ACTIVE')).toBe('active');
    expect(toAccountStatusKey('SAVINGSACCOUNTSTATUSTYPE.ACTIVE')).toBe('active');
    expect(toAccountStatusKey('loanStatusType.closed.written.off')).toBe('closed');
    expect(toAccountStatusKey('closed_written_off')).toBe('closed');
    expect(toAccountStatusKey('submittedAndPendingApproval')).toBe('pending');
    expect(toAccountStatusKey('preMatureClosure')).toBe('closed');
  });

  it('matches the whole normalised name, not one dot-segment of it', () => {
    // `closed` is the segment the colour comes from; a table keyed on a single word would paint the
    // outstanding-amount form of the same state from the wrong entry.
    expect(toAccountStatusKey('loanStatusType.closed.reschedule.outstanding.amount')).toBe('closed');
    expect(toAccountStatusKey('loanStatusType.transfer.in.progress')).toBe('other');
  });

  it('keeps a missing or unrecognised code neutral rather than claiming a state', () => {
    expect(toAccountStatusKey(undefined)).toBe('other');
    expect(toAccountStatusKey('')).toBe('other');
    expect(toAccountStatusKey('loanStatusType.notAStateYet')).toBe('other');
    expect(toAccountStatusKey('savingsAccountStatusType.overpaid')).toBe('other');
  });
});
