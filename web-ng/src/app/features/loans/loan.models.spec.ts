import { describe, expect, it } from 'vitest';
import { readSelectedId, toLoanStatusKey } from './loan.models';
import type { StatusKey } from '../../shared/status-key.util';

/** Every status the fork’s `LoanStatus` enum declares, by numeric id and by its `loanStatusType.*` code, with the indicator key it paints (AAP 0.7.2; the multi-segment closing codes and ids 400/602 are the regression guard). */
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

// The two shapes a persisted id arrives in — a plain number and the `{id, code, value}` object — so a reader accepting one shape would empty a select for the other.
const SELECTED_ID_CASES: readonly [string, unknown, number][] = [
  ['a plain number', 3, 3],
  [
    'the {id, code, value} object',
    { id: 3, code: 'interestRateFrequencyType.years', value: 'Per year' },
    3,
  ],
];
const UNSELECTED_VALUES: readonly [string, unknown][] = [
  ['an object without an id', { code: 'interestRateFrequencyType.years' }],
  ['an object whose id is text', { id: '3' }],
  ['a bare string', '3'],
  ['an array', [3]],
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
];

describe('readSelectedId', () => {
  it.each(SELECTED_ID_CASES)('reads the id of %s', (_label, value, id) => {
    expect(readSelectedId(value)).toBe(id);
  });
  it.each(UNSELECTED_VALUES)('reads no id from %s', (_label, value) => {
    expect(readSelectedId(value)).toBeNull();
  });
});
