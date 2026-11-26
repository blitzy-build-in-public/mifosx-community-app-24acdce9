/** Behaviour spec for `core/http/api-error.ts`, the one mapper that turns a failed Fineract response into the text and status a screen renders (AAP 0.7.1 row "`ApiError` + mapper"; AAP 0.7.2, AAP 0.7.4; Rule 1 clauses 3 and 8).
 *
 * Two rules meet in this file. An ordinary Fineract message reaches the user verbatim, which is the behavioural inheritance AAP 0.4.4 decision 6 records and what AAP 0.7.4 renders above a form; a message carrying a database's, a driver's or a framework's own words does not, because it is not text written for a user (qaw007-F02). The fork's exception mapping is out of this work's scope (AAP 0.9.2), so the guard lives here, and every case below drives it through the production mapper exactly as the interceptor does (AAP 0.4.2). */
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { ApiError, navigationFailure, screenFailure, toApiError, toDisplayableFailure } from './api-error';

/** The sentence the mapper answers with when no message written for the user reached the failure (AAP 0.7.2); a case pins it whole, because it is the text a user reads. */
const UNMAPPED_FAILURE_TEXT = 'The request could not be completed.';

/** An ordinary Fineract validation message, of the kind workflow W7 compares: the server's own text, which a screen must render verbatim (AAP 0.4.4 decision 6; AAP 0.7.4). */
const ORDINARY_MESSAGE = 'The parameter `firstname` exceeds max length of 50.';

/** Ordinary prose that mentions both words the database-internal shapes look for — "where" and "error" — and is still a message written for the user, so the guard must leave it alone rather than over-sanitise (qaw007-F02). */
const ORDINARY_PROSE =
  'The date cannot be in the future. Check where you entered it, the error is on the form.';

/** The text Fineract's envelope carried in the NUL-byte create captured for qaw007-F02: PostgreSQL's own failure, the encoding it failed on and the prepared statement that carried the value, verbatim. */
const DATABASE_INTERNAL_MESSAGE =
  'Unknown data integrity issue with resource: ERROR: invalid byte sequence for encoding "UTF8": 0x00\n  Where: unnamed portal parameter $7';

/** A field-level failure of Fineract's envelope, as the wire carries it — `args` included, which the client reads and never renders (AAP 0.7.2). */
interface WireValidationError {
  readonly developerMessage: string;
  readonly defaultUserMessage: string;
  readonly userMessageGlobalisationCode: string;
  readonly args: readonly unknown[];
}

/** Fineract's error envelope as the wire carries it: the members the client maps (`defaultUserMessage`, `errors`) beside the `developerMessage` and `httpStatusCode` it never reads (qaw007-F02). */
interface WireEnvelope {
  readonly developerMessage: string;
  readonly httpStatusCode: string;
  readonly defaultUserMessage: string;
  readonly userMessageGlobalisationCode: string;
  readonly errors: readonly WireValidationError[];
}

/** The exact HTTP 403 body `POST /clients` answered with a NUL byte in `lastname` (qaw007-F02 reproduction): both the field-level failure and the envelope's own text are the database's words, so neither may be rendered. */
const NUL_BYTE_ENVELOPE: WireEnvelope = {
  developerMessage: 'The request caused a data integrity issue to be fired by the database.',
  httpStatusCode: '403',
  defaultUserMessage: DATABASE_INTERNAL_MESSAGE,
  userMessageGlobalisationCode: 'error.msg.client.unknown.data.integrity.issue',
  errors: [
    {
      developerMessage: 'The request caused a data integrity issue to be fired by the database.',
      defaultUserMessage: DATABASE_INTERNAL_MESSAGE,
      userMessageGlobalisationCode: 'error.msg.client.unknown.data.integrity.issue',
      args: [],
    },
  ],
};

/** One message per shape the database, the driver or the framework answers with (qaw007-F02), each written the way the backend actually words it and each exercising only the shape its label names, so a case that stops matching reads against the pattern it exists for. */
const BACKEND_INTERNAL_MESSAGES: readonly (readonly [label: string, message: string])[] = [
  [
    "PostgreSQL's own ERROR line",
    'Unknown data integrity issue with resource: ERROR: relation "m_client" does not exist',
  ],
  ['a character-encoding failure', 'invalid byte sequence for encoding "UTF8": 0x00'],
  ["a prepared statement's parameter dump", 'Where: unnamed portal parameter $7'],
  ['an SQLState the driver reports', 'could not execute statement; SQLState [23505]'],
  [
    'a framework class name',
    'org.springframework.dao.DataIntegrityViolationException: could not execute statement',
  ],
  ['a driver exception type', 'PSQLException: could not receive the response'],
];

/** Bodies that carry no message a user could be shown: an empty envelope, the bare Spring envelope a 500 from `POST /authentication` answers with (qaw007-F02), a text body and no body at all. Each must become the generic sentence rather than an empty region (AAP 0.7.2). */
const MESSAGELESS_BODIES: readonly (readonly [label: string, body: unknown])[] = [
  ['an empty envelope', {}],
  [
    'a bare Spring error envelope',
    {
      timestamp: '2026-11-24T00:00:00.000+00:00',
      status: 500,
      error: 'Internal Server Error',
      path: '/fineract-provider/api/v1/authentication',
    },
  ],
  ['a text body', 'Internal Server Error'],
  ['no body at all', null],
];

/** Causes that are neither an `ApiError` nor an `HttpErrorResponse`: each is reported as the transport failure status `0` with the generic sentence, because nothing in it is a message the backend wrote for the user (AAP 0.7.2, AAP 0.9.2). */
const NON_HTTP_CAUSES: readonly (readonly [label: string, cause: unknown])[] = [
  ['an Error with no message', new Error('')],
  ['an object shaped like an error but not one', { message: 'not an Error' }],
  ['a string', 'something went wrong'],
  ['a number', 42],
];

/** Statuses the interceptor has already reported itself, so a screen paints nothing for them (AAP 0.7.4, AAP 0.14.2). */
const STATUSES_ALREADY_REPORTED: readonly (readonly [label: string, status: number])[] = [
  ['a server failure', 500],
  ['a transport failure', 0],
];

/** The failure a response produces, mapped by the production mapper exactly as the interceptor maps it (AAP 0.4.2). @param status HTTP status the response arrived with. @param error the response's body, as `HttpErrorResponse.error` holds it. @returns the displayable failure the interceptor rethrows. */
function failureOf(status: number, error: unknown): ApiError {
  return toApiError(new HttpErrorResponse({ status, error }));
}

describe('toApiError', () => {
  it('returns an ordinary Fineract validation message verbatim with its status', () => {
    const failure = failureOf(400, { defaultUserMessage: ORDINARY_MESSAGE });

    expect(failure.message).toBe(ORDINARY_MESSAGE);
    expect(failure.status).toBe(400);
    expect(failure.validationErrors).toEqual([]);
  });

  it('replaces the database text of the captured 403 envelope with the generic sentence, keeping its status and field-level failures', () => {
    const failure = failureOf(403, NUL_BYTE_ENVELOPE);

    expect(failure.message).toBe(UNMAPPED_FAILURE_TEXT);
    expect(failure.status).toBe(403);
    // The failure itself is unchanged, so the create screen's region still paints it inline and a consumer reading the field-level failures still sees what the server sent (AAP 0.7.2, AAP 0.7.4).
    expect(failure.validationErrors).toHaveLength(1);
    expect(failure.validationErrors[0]?.defaultUserMessage).toBe(DATABASE_INTERNAL_MESSAGE);
    expect(failure.validationErrors[0]?.userMessageGlobalisationCode).toBe(
      'error.msg.client.unknown.data.integrity.issue',
    );
    expect(screenFailure(failure)).toBe(failure);
    // Nothing of the database's words survives in the text a user reads.
    expect(failure.message).not.toContain('unnamed portal parameter');
    expect(failure.message).not.toContain('invalid byte sequence');
    expect(failure.message).not.toContain('ERROR:');
  });

  it('skips a database message in a field-level failure and keeps the envelope text written for the user', () => {
    const failure = failureOf(400, {
      defaultUserMessage: ORDINARY_MESSAGE,
      errors: [{ defaultUserMessage: DATABASE_INTERNAL_MESSAGE }],
    });

    expect(failure.message).toBe(ORDINARY_MESSAGE);
    expect(failure.validationErrors).toHaveLength(1);
    expect(failure.validationErrors[0]?.defaultUserMessage).toBe(DATABASE_INTERNAL_MESSAGE);
  });

  it.each(BACKEND_INTERNAL_MESSAGES)(
    'replaces %s with the generic sentence',
    (_label, message) => {
      const failure = failureOf(500, { defaultUserMessage: message });

      expect(failure.message).toBe(UNMAPPED_FAILURE_TEXT);
      expect(failure.status).toBe(500);
      expect(failure.validationErrors).toEqual([]);
    },
  );

  it('returns ordinary prose that mentions where and error verbatim, so the guard never over-sanitises', () => {
    const failure = failureOf(400, { defaultUserMessage: ORDINARY_PROSE });

    expect(failure.message).toBe(ORDINARY_PROSE);
    expect(failure.status).toBe(400);
  });

  it.each(MESSAGELESS_BODIES)(
    'answers the generic sentence for %s, keeping the status it arrived with',
    (_label, body) => {
      const failure = failureOf(500, body);

      expect(failure.message).toBe(UNMAPPED_FAILURE_TEXT);
      expect(failure.status).toBe(500);
      expect(failure.validationErrors).toEqual([]);
    },
  );
});

describe('toDisplayableFailure', () => {
  it('returns an ApiError unchanged', () => {
    const failure = new ApiError(ORDINARY_MESSAGE, 400);

    expect(toDisplayableFailure(failure)).toBe(failure);
  });

  it.each([[200], [400], [403], [500]])(
    'maps an HttpErrorResponse with status %i through the same mapper',
    (status) => {
      const failure = toDisplayableFailure(
        new HttpErrorResponse({ status, error: { defaultUserMessage: ORDINARY_MESSAGE } }),
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect(failure.message).toBe(ORDINARY_MESSAGE);
      expect(failure.status).toBe(status);
    },
  );

  it('reports a non-HTTP Error by its own message as a transport failure', () => {
    const failure = toDisplayableFailure(new Error('Navigation was refused'));

    expect(failure.message).toBe('Navigation was refused');
    expect(failure.status).toBe(0);
    expect(failure.validationErrors).toEqual([]);
  });

  it.each(NON_HTTP_CAUSES)(
    'answers the generic sentence for %s, with the transport-failure status',
    (_label, cause) => {
      const failure = toDisplayableFailure(cause);

      expect(failure.message).toBe(UNMAPPED_FAILURE_TEXT);
      expect(failure.status).toBe(0);
    },
  );
});

describe('screenFailure', () => {
  it('returns the failure for a 4xx, which a screen paints above its form', () => {
    const failure = failureOf(400, { defaultUserMessage: ORDINARY_MESSAGE });

    expect(screenFailure(failure)).toBe(failure);
  });

  it('keeps a 403 whose message was replaced, so the generic sentence is what the region shows', () => {
    const failure = failureOf(403, NUL_BYTE_ENVELOPE);

    expect(screenFailure(failure)).toBe(failure);
    expect(screenFailure(failure)?.message).toBe(UNMAPPED_FAILURE_TEXT);
  });

  it.each(STATUSES_ALREADY_REPORTED)(
    'answers null for %s the interceptor has already notified',
    (_label, status) => {
      const failure = failureOf(status, { defaultUserMessage: ORDINARY_MESSAGE });

      expect(screenFailure(failure)).toBeNull();
    },
  );
});

describe('navigationFailure', () => {
  it('names the destination when the navigation was refused for a reason that is not an HTTP failure', () => {
    const failure = navigationFailure(new Error('Navigation cancelled'), 'login screen');

    expect(failure.message).toBe('The login screen did not open. Reload the page and try again.');
    expect(failure.status).toBe(0);
    expect(failure.validationErrors).toEqual([]);
  });

  it('returns an ApiError unchanged', () => {
    const failure = new ApiError(ORDINARY_MESSAGE, 400);

    expect(navigationFailure(failure, 'login screen')).toBe(failure);
  });

  it('maps an HttpErrorResponse through the same mapper', () => {
    const failure = navigationFailure(
      new HttpErrorResponse({ status: 400, error: { defaultUserMessage: ORDINARY_MESSAGE } }),
      'login screen',
    );

    expect(failure.message).toBe(ORDINARY_MESSAGE);
    expect(failure.status).toBe(400);
  });
});
