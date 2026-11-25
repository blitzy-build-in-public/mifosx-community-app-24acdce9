import { describe, expect, it } from 'vitest';

import { datatableName, resourceId } from './path-segment.util';

/**
 * Behaviour spec for `core/http/path-segment.util.ts`, the guard every Fineract path segment passes
 * through (Rule 1 clause 8; AAP 0.14.2 "Test coverage"; review finding F06 / cr3-F06).
 *
 * The two points these cases pin are the ones the fix turns on:
 *
 *   - a value of Fineract's own shape is returned unchanged, so the URL a valid route parameter or a
 *     valid datatable name produces is byte-identical to the one the legacy application sent
 *     (Rule 1 clause 2; AAP 0.1.1 "Parity is behavioural, not visual"); and
 *   - a value of any other shape is refused with a message that quotes it, names the call that
 *     composed it and says no request was issued, which is what stops a crafted `:id` from moving the
 *     request to another path on the same host (CWE-20, CWE-22).
 *
 * Neither function touches Angular, `HttpClient` or the configuration, so these cases need no
 * `TestBed`: the observable form the refusal reaches a caller in is asserted where the services
 * compose it, in their own specs.
 */

/** The `source` these cases pass, so the message assertions read against a named call. */
const SOURCE = 'PathSegmentSpec.call';

/**
 * The message a call refused with, or the empty string when it did not throw.
 *
 * Returning the text rather than asserting inside the `catch` keeps every case's assertions in one
 * place: a call that wrongly succeeds leaves `''`, and the `toContain` below reports the value it
 * expected to be quoted.
 *
 * @param run the call under test.
 * @returns the refusal's message.
 */
function refusalMessage(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  return '';
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
    const message = refusalMessage(() => resourceId(value, SOURCE));

    // The value itself is quoted, so a caller reading the failure knows which route parameter it came
    // from rather than only that some identifier was refused.
    expect(message).toContain(`'${value}'`);
    // The call that composed the segment is named, so the failure points at one place in the services.
    expect(message).toContain(SOURCE);
    // The message states the consequence and that nothing was sent: the refusal is the whole outcome.
    expect(message).toContain('another path');
    expect(message).toContain('no request');
  });
});

describe('datatableName', () => {
  it.each(ACCEPTED_DATATABLE_NAMES)('returns the registered table name %j unchanged', (name) => {
    expect(datatableName(name, SOURCE)).toBe(name);
  });

  it.each(REFUSED_DATATABLE_NAMES)('refuses the server-supplied name %j and issues no request', (name) => {
    const message = refusalMessage(() => datatableName(name, SOURCE));

    expect(message).toContain(`'${name}'`);
    expect(message).toContain(SOURCE);
    expect(message).toContain('another path');
    expect(message).toContain('no request');
  });
});
