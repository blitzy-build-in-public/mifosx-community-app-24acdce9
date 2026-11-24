import { describe, expect, it } from 'vitest';

import { toClientStatusKey } from './client.models';
import type { StatusKey } from '../../shared/status-swatch/status-swatch.component';

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
