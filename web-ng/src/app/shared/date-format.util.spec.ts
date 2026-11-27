import { describe, expect, it } from 'vitest';

import { AVAILABLE_LANGS } from '../core/i18n/translate.config';
import { DISPLAY_DATE_FORMAT, fromFineractDate, toFineractDate } from './date-format.util';

/** Narrows a parse result the calling test has already decided must be a date, without an optional chain that would let a `null` reach an assertion as `undefined`. */
function asDate(value: Date | null): Date {
  expect(value).toBeInstanceOf(Date);

  if (value === null) {
    throw new Error('expected the input to parse as a date');
  }

  return value;
}

describe('DISPLAY_DATE_FORMAT', () => {
  it('is the one Fineract pattern, used for a payload value and a rendered date alike', () => {
    expect(DISPLAY_DATE_FORMAT).toBe('dd MMMM yyyy');
  });
});

describe('toFineractDate', () => {
  it('renders the two dates the client record shows (Figma node 1:4)', () => {
    expect(toFineractDate(new Date(2026, 10, 21), 'en')).toBe('21 November 2026');
    expect(toFineractDate(new Date(1988, 2, 14), 'en')).toBe('14 March 1988');
  });

  it('keeps the contract pattern for a single-digit day and for a time late in the day', () => {
    expect(toFineractDate(new Date(2026, 0, 1), 'en')).toBe('01 January 2026');
    expect(toFineractDate(new Date(2026, 10, 21, 23, 59, 59), 'en')).toBe('21 November 2026');
  });

  it('returns null rather than a placeholder string when there is no date to send', () => {
    expect(toFineractDate(null, 'en')).toBeNull();
    expect(toFineractDate(undefined, 'en')).toBeNull();
    expect(toFineractDate(new Date(Number.NaN), 'en')).toBeNull();
  });

  it('renders the month name in the language the payload carries, not in English', () => {
    expect(toFineractDate(new Date(2026, 10, 21), 'fr')).toBe('21 novembre 2026');
    expect(toFineractDate(new Date(2026, 10, 21), 'es')).toBe('21 noviembre 2026');
  });

  it.each(AVAILABLE_LANGS)('formats a date in %s without reporting a missing locale', (language: string) => {
      expect(toFineractDate(new Date(2026, 10, 21), language)).toMatch(/^21 .+ 2026$/u);
    }, );

  it('formats a regional code with its base language data', () => {
    expect(toFineractDate(new Date(2026, 10, 21), 'pt_BR')).toBe('21 novembro 2026');
    expect(toFineractDate(new Date(2026, 10, 21), 'fr-CA')).toBe('21 novembre 2026');
  });

  it('reports a language it ships no locale data for instead of using another language', () => {
    expect(() => toFineractDate(new Date(2026, 10, 21), 'et')).toThrow(/No Angular locale data|no locale data/i, );
  });
});

describe('fromFineractDate', () => {
  it.each([['1988-03-14', 1988, 2, 14], ['2026-11-21', 2026, 10, 21], ['2026-01-01', 2026, 0, 1], ['2026-12-31', 2026, 11, 31], ])(
    'parses %s as local midnight, so the day never shifts by timezone', (input: string, year: number, month: number, day: number) => {
      const parsed = asDate(fromFineractDate(input));

      expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([year, month, day, ]);
      expect(parsed.getHours()).toBe(0);
      expect(parsed.getMinutes()).toBe(0);
    }, );

  it('reads the leading date part of a full ISO string', () => {
    const parsed = asDate(fromFineractDate('2026-11-21T00:00:00.000+0000'));

    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 10, 21]);
  });

  it('parses the business-date triple with its one-based month', () => {
    const parsed = asDate(fromFineractDate([2026, 11, 21]));

    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 10, 21]);
  });

  it('copies a Date rather than handing back the instance it was given', () => {
    const source = new Date(2026, 10, 21);
    const parsed = asDate(fromFineractDate(source));

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);

    source.setFullYear(2030);

    expect(parsed.getFullYear()).toBe(2026);
  });

  it('returns null for every value that is not one of the three shapes Fineract sends', () => {
    expect(fromFineractDate('not-a-date')).toBeNull();
    expect(fromFineractDate('')).toBeNull();
    expect(fromFineractDate('21 November 2026')).toBeNull();
    expect(fromFineractDate(null)).toBeNull();
    expect(fromFineractDate(undefined)).toBeNull();
    expect(fromFineractDate(42)).toBeNull();
    expect(fromFineractDate({})).toBeNull();
    expect(fromFineractDate([2026, 11])).toBeNull();
    expect(fromFineractDate([2026, 11, 21, 1])).toBeNull();
    expect(fromFineractDate(['2026', 11, 21])).toBeNull();
    expect(fromFineractDate([2026, 11.5, 21])).toBeNull();
    expect(fromFineractDate(new Date(Number.NaN))).toBeNull();
  });

  it('rejects a part combination no calendar holds instead of rolling it forward', () => {
    expect(fromFineractDate('2026-02-30')).toBeNull();
    expect(fromFineractDate([2026, 13, 1])).toBeNull();
    expect(fromFineractDate([2026, 0, 10])).toBeNull();
    expect(fromFineractDate([2026, 4, 31])).toBeNull();
  });

  it('keeps the calendar day across a parse and a format', () => {
    const parsed = asDate(fromFineractDate('2026-11-21'));

    expect(toFineractDate(parsed, 'en')).toBe('21 November 2026');
    expect(asDate(fromFineractDate('2026-11-21')).getTime()).toBe(parsed.getTime());
  });
});
