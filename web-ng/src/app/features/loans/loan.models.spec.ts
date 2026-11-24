import { describe, expect, it } from 'vitest';

import { toLoanStatusKey } from './loan.models';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';

/**
 * Every status the fork's `LoanStatus` enum declares (`LoanStatus.java`), by its numeric id and by
 * its `loanStatusType.*` message code, with the indicator key each one must paint.
 *
 * The four multi-segment closing codes are the ones a last-segment match used to drop, and `400`
 * and `602` are terminal states the id table used to omit, so this list is also the regression
 * guard for both.
 */
const STATUS_CASES: readonly {
  readonly id: string | number;
  readonly code: string;
  readonly key: StatusKey;
}[] = [
  { id: 0, code: 'loanStatusType.invalid', key: 'other' },
  { id: 100, code: 'loanStatusType.submitted.and.pending.approval', key: 'pending' },
  { id: 200, code: 'loanStatusType.approved', key: 'pending' },
  { id: 300, code: 'loanStatusType.active', key: 'active' },
  { id: 303, code: 'loanStatusType.transfer.in.progress', key: 'other' },
  { id: 304, code: 'loanStatusType.transfer.on.hold', key: 'other' },
  { id: 400, code: 'loanStatusType.withdrawn.by.client', key: 'closed' },
  { id: 500, code: 'loanStatusType.rejected', key: 'closed' },
  { id: 600, code: 'loanStatusType.closed.obligations.met', key: 'closed' },
  { id: 601, code: 'loanStatusType.closed.written.off', key: 'closed' },
  { id: 602, code: 'loanStatusType.closed.reschedule.outstanding.amount', key: 'closed' },
  { id: 700, code: 'loanStatusType.overpaid', key: 'closed' },
];

describe('toLoanStatusKey', () => {
  it('paints the key of every status id the LoanStatus enum declares', () => {
    for (const { id, key } of STATUS_CASES) {
      expect(toLoanStatusKey(id), String(id)).toBe(key);
    }
  });

  it('paints the key of every loanStatusType.* code, whole name and all', () => {
    for (const { code, key } of STATUS_CASES) {
      expect(toLoanStatusKey(code), code).toBe(key);
    }
  });

  it('accepts the id as text, and a code without its prefix', () => {
    expect(toLoanStatusKey('300')).toBe('active');
    expect(toLoanStatusKey('rejected')).toBe('closed');
    expect(toLoanStatusKey('closed.reschedule.outstanding.amount')).toBe('closed');
  });

  it('never paints an id the enum does not declare', () => {
    expect(toLoanStatusKey(900)).toBe('other');
    expect(toLoanStatusKey('900')).toBe('other');
  });

  it('keeps a missing or unrecognised status neutral rather than claiming a state', () => {
    expect(toLoanStatusKey(null)).toBe('other');
    expect(toLoanStatusKey(undefined)).toBe('other');
    expect(toLoanStatusKey('')).toBe('other');
    expect(toLoanStatusKey('loanStatusType.notAStateYet')).toBe('other');
  });
});
