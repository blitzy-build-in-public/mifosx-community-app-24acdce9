import { formatDate } from '@angular/common';

import { FINERACT_DATE_FORMAT } from '../core/config/app-config.model';
import { ensureLocaleData } from '../core/i18n/locale-data';

/** Formatting and parsing for every date the application shows or sends (AAP 0.7.1 `shared/date-format.util.ts`, AAP 0.7.2 date handling, AAP 0.5.4 gap "Date picker", AAP 0.11.1) (Rule 1 clause 2, AAP 0.10.5). */

/** The single declaration of the two shapes a Fineract response sends a date in: the `'yyyy-MM-dd'` string — a record's date, or a template's default — and the `[year, month, day]` triple with a one-based month, which is the shape Fineract returns for a business date and for a date inside a response body (AAP 0.7.2). */
export type FineractDate = string | readonly [number, number, number];

/** The one pattern for both a payload value and a rendered date: `dd MMMM yyyy`, e.g. `21 November 2026`. Equal to `FINERACT_DATE_FORMAT`, which is also `AppConfig.dateFormat`, so a payload format and a display format cannot drift apart; a component renders through this constant rather than a locale-defaulted `DatePipe` format, because the legacy screens show this pattern in every language (Rule 1 clause 3). */
export const DISPLAY_DATE_FORMAT: string = FINERACT_DATE_FORMAT;

/** Formats a field's date for a date-bearing Fineract payload, or reports that there is no date: the result is sent alongside `dateFormat: DISPLAY_DATE_FORMAT` and the body's `locale` (AAP 0.7.3 rules that apply to every call; Rule 1 clause 3, AAP 0.7.2). */
export function toFineractDate(value: Date | null | undefined, locale: string): string | null {
  if (value === null || value === undefined || Number.isNaN(value.getTime())) {
    return null;
  }

  // Deliberate departure from legacy, registered in the AAP: the legacy AngularJS app loaded no angular-locale bundle, so its date filter produced English month names beside a non-English `locale`; AAP 0.7.2 date handling requires the active locale instead, and registering the data is what lets `formatDate` render the month name in that language while `dateFormat` and `locale` stay exactly the values legacy sent (Rule 1 clause 2).
  ensureLocaleData(locale);

  return formatDate(value, DISPLAY_DATE_FORMAT, locale);
}

/** Reads a date Fineract returned into the local-midnight `Date` a field or a table cell holds: what `GET /clients/{id}` sends as `'1988-03-14'`, what `GET /businessdate/BUSINESS_DATE` sends as `[2026, 11, 21]`, and a value of any other shape or a `null`, each answered with `null` rather than a guessed date (Rule 1 clause 4). */
export function fromFineractDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'string') {
    const leadingDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (leadingDate === null) {
      return null;
    }

    return fromCalendarParts(Number(leadingDate[1]), Number(leadingDate[2]), Number(leadingDate[3]), );
  }

  if (isDateTriple(value)) {
    const [year, month, day] = value;

    return fromCalendarParts(year, month, day);
  }

  return null;
}

/** Narrows a `readonly [year, month, day]` number triple — the shape Fineract returns for a business date and for a date inside a response body, with a one-based month; integers only, because a fractional part is not a calendar day. */
function isDateTriple(value: unknown): value is readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }

  const [year, month, day]: unknown[] = value;

  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day);
}

/** Builds a local-midnight `Date` from a year, a one-based month and a day, or `null` when no calendar holds that combination — `'2026-02-30'`, month 13 — instead of letting `Date` roll it into the following month, which would report an event on a day the user never entered; the date field's own input parser calls this too, so the two cannot disagree about which days exist. */
export function fromCalendarParts(year: number, month: number, day: number): Date | null {
  const date = new Date(2000, month - 1, day);
  date.setFullYear(year);

  const namesSameDay =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return namesSameDay ? date : null;
}
