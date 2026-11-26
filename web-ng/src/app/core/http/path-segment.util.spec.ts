import { describe, expect, it } from 'vitest';

import { datatableName, resourceId } from './path-segment.util';

/** Behaviour spec for `core/http/path-segment.util.ts`, the guard every Fineract path segment passes through (Rule 1 clause 8; AAP 0.14.2 "Test coverage"; review finding F05) (Rule 1 clause 2, AAP 0.1.1). */

/** The `source` these cases pass, so the refusal's diagnostic reads against a named call. */
const SOURCE = 'PathSegmentSpec.call';

/** The sentence a refused identifier is reported with — the text a screen renders, pinned whole. */
const RESOURCE_ID_SENTENCE = 'The record could not be opened because its address is not valid.';

/** The sentence a refused datatable name is reported with — the text a screen renders, pinned whole. */
const DATATABLE_NAME_SENTENCE =
  'The account action could not be checked because the server named a table that is not valid.';

/** The error a call refused with, or `null` when it did not throw. */
function refusal(run: () => unknown): Error | null {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof Error ? error : null;
  }

  return null;
}

/** The diagnostic a refusal carries in `cause`, as text. `Error.cause` is typed `unknown`, so the spec reads it as a string instead of casting it: a cause that is missing, or that is not the interpolated diagnostic, shows (Rule 1 clause 4). */
function causeText(error: Error | null): string {
  const cause: unknown = error?.cause;

  return typeof cause === 'string' ? cause : '';
}

/** Values of Fineract's identifier shape, each of which must come back unchanged. */
const ACCEPTED_RESOURCE_IDS: readonly (readonly [label: string, id: number | string, segment: string])[] = [
  ['a numeric id', 2, '2'],
  ['a numeric zero', 0, '0'],
  ['a route-string id', '2', '2'],
  ['a zero-padded route-string id', '000000002', '000000002'],
];

/** Route values that are not an identifier, each of which must be refused before a request exists. */
const REFUSED_RESOURCE_IDS: readonly string[] = ['', '../..', '..%2Fx', '1/2', '-1', '1.5', 'NaN', '1e+21'];

/** Datatable names of Fineract's shape, each of which must come back unchanged. */
const ACCEPTED_DATATABLE_NAMES: readonly string[] = ['client_extra_details', 'm_client_2', '_'];

/** Server-supplied names that are not a registered table, each of which must be refused. */
const REFUSED_DATATABLE_NAMES: readonly string[] = ['../..', 'a/b', '', 'a b'];

describe('resourceId', () => {
  it.each(ACCEPTED_RESOURCE_IDS)('returns %s unchanged as the path segment', (_label, id, segment) => {
    expect(resourceId(id, SOURCE)).toBe(segment);
  });

  it.each(REFUSED_RESOURCE_IDS)('refuses the route value %j and issues no request', (value) => {
    const error = refusal(() => resourceId(value, SOURCE));

    // The message is the one fixed sentence, so the staff user whose route was refused reads a sentence about the record rather than a developer diagnostic.
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe(RESOURCE_ID_SENTENCE);
    // Neither the rejected value nor the composing call appears in it.
    expect(error?.message).not.toContain(SOURCE);
    expect(error?.message).not.toContain('PathSegment.');
    if (value !== '') {
      expect(error?.message).not.toContain(value);
    }

    // The diagnostic is kept, out of the message: the call and the value it was handed are both readable in `cause`, so a developer can still find the request that was refused.
    expect(causeText(error)).toContain(SOURCE);
    expect(causeText(error)).toContain(`'${value}'`);
  });
});

describe('datatableName', () => {
  it.each(ACCEPTED_DATATABLE_NAMES)('returns the registered table name %j unchanged', (name) => {
    expect(datatableName(name, SOURCE)).toBe(name);
  });

  it.each(REFUSED_DATATABLE_NAMES)('refuses the server-supplied name %j and issues no request', (name) => {
    const error = refusal(() => datatableName(name, SOURCE));

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe(DATATABLE_NAME_SENTENCE);
    expect(error?.message).not.toContain(SOURCE);
    expect(error?.message).not.toContain('PathSegment.');
    if (name !== '') {
      expect(error?.message).not.toContain(name);
    }

    expect(causeText(error)).toContain(SOURCE);
    expect(causeText(error)).toContain(`'${name}'`);
  });
});
