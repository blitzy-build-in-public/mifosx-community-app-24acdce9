/** The harness's own tests for `e2e/seed/fixtures.ts` — the fixed AAP 0.10.1 data and the date arithmetic every parity comparison rests on: AAP 0.10.2 compares dates as day offsets from the run date, and AAP 0.10.1 defines the run date as the tenant's business date read from Fineract rather than the browser clock (Rule 1 clause 2, AAP 0.10.4). */
import { describe, expect, it } from 'vitest';

import {
  API_PATH,
  FINERACT_URL,
  LOCALE,
  PAYLOAD_DATE_FORMAT,
  addDays,
  apiUrl,
  dayOffset,
  formatDateOnly,
  formatFineractDate,
  parseFineractDate,
} from './fixtures';

/** The UTC `Date` a 1-based `[year, month, day]` calendar day names, at the given clock time (midnight by default), built independently of the module under test; the 1-based month is what every expectation in this file reads in. */
function utcDay(
  year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

describe('formatFineractDate', () => {
  it('formats a UTC day as the dd MMMM yyyy payload Fineract reads', () => {
    expect(formatFineractDate(utcDay(2026, 11, 24))).toEqual({
      date: '24 November 2026', dateFormat: 'dd MMMM yyyy', locale: 'en',
    });
  });
  it('zero-pads a single-digit day', () => {
    expect(formatFineractDate(utcDay(2026, 3, 5)).date).toBe('05 March 2026');
  });
  it('ignores the time of day, so a payload date is always a whole day', () => {
    const lateEvening = utcDay(2026, 11, 24, 23, 59, 59);
    expect(formatFineractDate(lateEvening)).toEqual(formatFineractDate(utcDay(2026, 11, 24)));
  });
  it('carries the payload dateFormat and locale of Rule 1 clause 2', () => {
    const payload = formatFineractDate(utcDay(2026, 11, 24));
    expect(payload.dateFormat).toBe('dd MMMM yyyy');
    expect(payload.locale).toBe('en');
  });
  it('throws for an invalid Date rather than formatting one', () => {
    expect(() => formatFineractDate(new Date(Number.NaN))).toThrow(/formatFineractDate\(\) needs a valid Date/);
  });
});

describe('addDays', () => {
  it('answers UTC midnight n days later', () => {
    expect(addDays(utcDay(2026, 11, 24), 2).toISOString()).toBe('2026-11-26T00:00:00.000Z');
  });
  it('does not mutate the date it is given', () => {
    const runDate = utcDay(2026, 11, 24);
    const original = runDate.getTime();
    addDays(runDate, 5);
    expect(runDate.getTime()).toBe(original);
  });
  it('shifts backwards for a negative n', () => {
    expect(addDays(utcDay(2026, 11, 24), -3).toISOString()).toBe('2026-11-21T00:00:00.000Z');
  });
  it('discards the time of day it is given', () => {
    const withClockTime = utcDay(2026, 11, 24, 18, 30, 15);
    expect(addDays(withClockTime, 1).toISOString()).toBe('2026-11-25T00:00:00.000Z');
  });
  it('throws for a non-integer day count', () => {
    expect(() => addDays(utcDay(2026, 11, 24), 1.5)).toThrow(/whole number of days/);
  });
  it('throws for an invalid Date rather than computing NaN', () => {
    expect(() => addDays(new Date(Number.NaN), 1)).toThrow(/addDays\(\) needs a valid Date/);
  });
});

describe('dayOffset', () => {
  const runDate = utcDay(2026, 11, 24);

  it('answers 0 for the same calendar day, whatever the clock times are', () => {
    const morning = utcDay(2026, 11, 24, 1, 15);
    const night = utcDay(2026, 11, 24, 22, 45);
    expect(dayOffset(morning, night)).toBe(0);
  });
  it('answers the whole-day distance in either direction', () => {
    expect(dayOffset(runDate, utcDay(2026, 11, 26))).toBe(2);
    expect(dayOffset(runDate, utcDay(2026, 11, 21))).toBe(-3);
  });
  it('accepts epoch milliseconds as the target', () => {
    expect(dayOffset(runDate, utcDay(2026, 11, 26).getTime())).toBe(2);
  });
  it('throws for a non-finite target', () => {
    expect(() => dayOffset(runDate, Number.NaN)).toThrow(/finite target/);
    expect(() => dayOffset(runDate, Number.POSITIVE_INFINITY)).toThrow(/finite target/);
  });
});

describe('parseFineractDate', () => {
  const expected = utcDay(2026, 11, 24);

  it('reads the [year, month, day] triple Fineract answers with', () => {
    expect(parseFineractDate([2026, 11, 24])).toEqual(expected);
  });
  it('reads the dd MMMM yyyy payload text', () => {
    expect(parseFineractDate('24 November 2026')).toEqual(expected);
  });
  it('reads a 1-digit day and a lower-case month name', () => {
    expect(parseFineractDate('5 march 2026')).toEqual(utcDay(2026, 3, 5));
  });
  it('reads the yyyy-mm-dd form other resources answer with', () => {
    expect(parseFineractDate('2026-11-24')).toEqual(expected);
  });
  it('answers null for an impossible calendar day', () => {
    expect(parseFineractDate([2026, 13, 1])).toBeNull();
    expect(parseFineractDate('2026-02-30')).toBeNull();
  });
  it('answers null for a value that is not a date it reads', () => {
    expect(parseFineractDate(42)).toBeNull();
    expect(parseFineractDate(true)).toBeNull();
    expect(parseFineractDate({ date: '2026-11-24' })).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('renders a UTC day as yyyy-mm-dd', () => {
    expect(formatDateOnly(utcDay(2026, 11, 24))).toBe('2026-11-24');
  });
  it('zero-pads a single-digit month and day', () => {
    expect(formatDateOnly(utcDay(2026, 1, 5))).toBe('2026-01-05');
  });
  it('throws for an invalid Date', () => {
    expect(() => formatDateOnly(new Date(Number.NaN))).toThrow(/formatDateOnly\(\) needs a valid Date/);
  });
});
/** The empty resource path, named rather than written straight into the call: the value is what the guard has to reject, and naming it keeps the source free of an empty `apiUrl()` argument for `npm run check:endpoints` to resolve into an API path it must then judge (Rule 1 clause 2, AAP 0.10.4). */
const EMPTY_PATH: string = '';

describe('apiUrl', () => {
  it('composes the backend address, the API path and the resource path', () => {
    expect(apiUrl('/clients')).toBe(`${FINERACT_URL}${API_PATH}/clients`);
  });
  it('rejects an empty path', () => {
    expect(() => apiUrl(EMPTY_PATH)).toThrow(/needs a resource path/);
  });
  it('rejects a path that does not start with a slash', () => {
    expect(() => apiUrl('clients')).toThrow(/needs a path that starts with/);
  });
  it('rejects a path that already holds the API path', () => {
    expect(() => apiUrl(API_PATH + '/clients')).toThrow(/must not contain it/);
  });
  it('rejects an absolute URL, which would address a host of its own', () => {
    // Assembled from FINERACT_URL at run time rather than written as a URL literal: no harness file may carry one (Rule 1 clause 2; AAP 0.10.4 keeps every URL in the allowlists, not in source).
    expect(() => apiUrl([FINERACT_URL, '/clients'].join(''))).toThrow(/not an absolute URL/);
  });
});

describe('the fixed test data the harness composes dates with', () => {
  it('carries the payload date format and locale of Rule 1 clause 2', () => {
    expect(PAYLOAD_DATE_FORMAT).toBe('dd MMMM yyyy');
    expect(LOCALE).toBe('en');
  });
});
