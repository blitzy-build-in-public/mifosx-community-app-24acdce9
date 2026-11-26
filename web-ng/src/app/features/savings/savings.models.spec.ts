import { describe, expect, it } from 'vitest';

import { toSavingsStatusKey } from './savings.models';
import type { StatusKey } from '../../shared/status-key.util';

/** Every status the fork's `SavingsAccountStatusType` enum declares (`SavingsAccountStatusType.java`), with the indicator key it must paint; `pre.mature.closure` and `matured` are the two terminal codes a substring test on `closed` used to leave neutral, so this list is also their regression guard. */
const STATUS_CASES: readonly { readonly code: string; readonly key: StatusKey }[] = [
  { code: 'savingsAccountStatusType.invalid', key: 'other' },
  { code: 'savingsAccountStatusType.submitted.and.pending.approval', key: 'pending' },
  { code: 'savingsAccountStatusType.approved', key: 'pending' }, { code: 'savingsAccountStatusType.active', key: 'active' },
  { code: 'savingsAccountStatusType.transfer.in.progress', key: 'other' },
  { code: 'savingsAccountStatusType.transfer.on.hold', key: 'other' },
  { code: 'savingsAccountStatusType.withdrawn.by.applicant', key: 'closed' }, { code: 'savingsAccountStatusType.rejected', key: 'closed' },
  { code: 'savingsAccountStatusType.closed', key: 'closed' }, { code: 'savingsAccountStatusType.pre.mature.closure', key: 'closed' },
  { code: 'savingsAccountStatusType.matured', key: 'closed' }, ];

describe('toSavingsStatusKey', () => {
  it('paints the key of every code the SavingsAccountStatusType enum declares', () => {
    for (const { code, key } of STATUS_CASES) {
      expect(toSavingsStatusKey(code), code).toBe(key);
    }
  });

  it('matches the whole normalised name, not one dot-segment of it', () => {
    expect(toSavingsStatusKey('active')).toBe('active');
    expect(toSavingsStatusKey('SAVINGSACCOUNTSTATUSTYPE.ACTIVE')).toBe('active');
    expect(toSavingsStatusKey('pre.mature.closure')).toBe('closed');
  });

  it('keeps a missing or unrecognised code neutral rather than claiming a state', () => {
    expect(toSavingsStatusKey(undefined)).toBe('other');
    expect(toSavingsStatusKey('')).toBe('other');
    expect(toSavingsStatusKey('savingsAccountStatusType.notAStateYet')).toBe('other');
  });
});
