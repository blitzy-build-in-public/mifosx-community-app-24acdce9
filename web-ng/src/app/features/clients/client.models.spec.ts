import { describe, expect, it } from 'vitest';
import {
  CLIENT_ACTION_PERMISSIONS,
  isClosedClientStatus,
  isTerminalClientStatus,
  toAccountStatusKey,
  toClientStatusKey,
  type ClientActionCommand,
} from './client.models';
import type { StatusKey } from '../../shared/status-key.util';

/** Every status the fork's `ClientStatus` enum declares (`ClientStatus.java`), with the indicator key it must paint. */
const STATUS_CASES: readonly { readonly code: string; readonly key: StatusKey }[] = [
  { code: 'clientStatusType.invalid', key: 'other' },
  { code: 'clientStatusType.pending', key: 'pending' },
  { code: 'clientStatusType.active', key: 'active' },
  { code: 'clientStatusType.transfer.in.progress', key: 'other' },
  { code: 'clientStatusType.transfer.on.hold', key: 'other' },
  { code: 'clientStatusType.closed', key: 'closed' },
  { code: 'clientStatusType.rejected', key: 'other' },
  { code: 'clientStatusType.withdraw', key: 'other' },
];

describe('toClientStatusKey', () => {
  it('paints the key of every code the ClientStatus enum declares', () => {
    for (const { code, key } of STATUS_CASES) { expect(toClientStatusKey(code), code).toBe(key); }
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
/** The clients list's "Show Closed" input, which is a different question from the swatch's colour: the list hides one code. */
describe('isClosedClientStatus', () => {
  it('answers true for the closed code and false for every other state the client enum declares', () => {
    expect(isClosedClientStatus('clientStatusType.closed')).toBe(true);
    // The two states the colour key paints `other` stay visible on the list (Rule 1 clause 3).
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
/** The three codes that end a client's lifecycle, which are the records the client view offers `Reactivate` on. */
const TERMINAL_CODES: readonly string[] = [
  'clientStatusType.closed',
  'clientStatusType.rejected',
  'clientStatusType.withdraw',
];
/** The codes that do not end it: the open states, the two transfers and an invalid record. */
const OPEN_CODES: readonly string[] = [
  'clientStatusType.active',
  'clientStatusType.pending',
  'clientStatusType.transfer.in.progress',
  'clientStatusType.transfer.on.hold',
  'clientStatusType.invalid',
];
/** The client record's own question about the status — a lifecycle one, neither the checkbox's question above nor the swatch's colour. */
describe('isTerminalClientStatus', () => {
  it('answers true for the closed, the rejected and the withdrawn codes, as the payloads spell them', () => {
    for (const code of TERMINAL_CODES) { expect(isTerminalClientStatus(code), code).toBe(true); }
  });
  it('answers true for the same codes in the upper-cased spelling the server also sends', () => {
    for (const code of TERMINAL_CODES) { expect(isTerminalClientStatus(code.toUpperCase()), code).toBe(true); }
  });
  it('answers false for every state that leaves the record its actions', () => {
    for (const code of OPEN_CODES) { expect(isTerminalClientStatus(code), code).toBe(false); }
  });
  it('answers false for a missing, an empty or an unrecognised code rather than claiming a terminal state', () => {
    expect(isTerminalClientStatus(undefined)).toBe(false);
    expect(isTerminalClientStatus('')).toBe(false);
    expect(isTerminalClientStatus('clientStatusType.notAStateYet')).toBe(false);
  });
});
/** Every status the fork's two account enums declare — `LoanStatus.java` for `loanStatusType.*` and `SavingsAccountStatusType.java` for `savingsAccountStatusType.*`. */
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
  { code: 'loanStatusType.withdrawn.by.client', key: 'other' },
  { code: 'loanStatusType.rejected', key: 'other' },
  { code: 'savingsAccountStatusType.closed', key: 'closed' },
  { code: 'savingsAccountStatusType.matured', key: 'closed' },
  { code: 'savingsAccountStatusType.pre.mature.closure', key: 'closed' },
  { code: 'savingsAccountStatusType.withdrawn.by.applicant', key: 'other' },
  { code: 'savingsAccountStatusType.rejected', key: 'other' },
  { code: 'loanStatusType.invalid', key: 'other' },
  { code: 'savingsAccountStatusType.invalid', key: 'other' },
  { code: 'loanStatusType.transfer.in.progress', key: 'other' },
  { code: 'savingsAccountStatusType.transfer.on.hold', key: 'other' },
];

describe('toAccountStatusKey', () => {
  it('paints the key of every code the two account status enums declare', () => {
    for (const { code, key } of ACCOUNT_STATUS_CASES) { expect(toAccountStatusKey(code), code).toBe(key); }
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
    // `closed` is the segment the colour comes from; a table keyed on a single word would paint the outstanding-amount form of the same state from the wrong entry.
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
/** The legacy code each of the five in-scope lifecycle commands is gated on: the `taskPermissionName` of that command's entry in `/root/community-app/app/scripts/models/clientStatus.js`. */
const COMMAND_PERMISSIONS: readonly { readonly command: ClientActionCommand; readonly permission: string }[] = [
  { command: 'activate', permission: 'ACTIVATE_CLIENT' },
  { command: 'close', permission: 'CLOSE_CLIENT' },
  { command: 'reject', permission: 'REJECT_CLIENT' },
  { command: 'withdraw', permission: 'WITHDRAW_CLIENT' },
  { command: 'reactivate', permission: 'REACTIVATE_CLIENT' },
];

describe('CLIENT_ACTION_PERMISSIONS', () => {
  it('gates each of the five legacy commands on the code legacy gives it', () => {
    for (const { command, permission } of COMMAND_PERMISSIONS) {
      expect(CLIENT_ACTION_PERMISSIONS[command], command).toBe(permission);
    }
  });
  it('holds a code for every command of the union and for no other key', () => {
    expect(Object.keys(CLIENT_ACTION_PERMISSIONS).sort()).toEqual(
      COMMAND_PERMISSIONS.map((entry) => entry.command).sort(),
    );
  });
});
