import { formatDate } from '@angular/common';

import { FINERACT_DATE_FORMAT } from '../core/config/app-config.model';
import { ensureLocaleData } from '../core/i18n/locale-data';

/**
 * Formatting and parsing for every date the application shows or sends (AAP 0.7.1,
 * `shared/date-format.util.ts` — "format/parse helpers shared by services and fields"; AAP 0.7.2,
 * "Date handling"; AAP 0.5.4, gap "Date picker"; AAP 0.11.1, this file's row).
 *
 * One pattern serves both jobs — `dd MMMM yyyy`, so `21 November 2026` is what the client record
 * renders (Figma node `1:4`) and what a date-bearing Fineract body carries beside the active
 * `locale`. That is the legacy contract, and it is fixed here rather than configurable so no screen
 * can introduce a second format (AAP 0.7.2; Rule 1 clause 2).
 *
 * Deliberately a pair of plain functions: a form field holds a `Date | null`, a service calls
 * `toFineractDate` at the boundary where it builds a payload, and a screen reading a date back from
 * Fineract calls `fromFineractDate`. No class, no injection, no clock read — the same input always
 * produces the same output, and the caller passes the locale rather than this module resolving one.
 * The tenant business date is never read here: a form's own default date follows legacy and comes
 * from the browser clock (AAP 0.10.5 item 15), and deriving the run date belongs to the E2E harness.
 */

/**
 * The single declaration of the two shapes a Fineract response sends a date in.
 *
 * They are the `'yyyy-MM-dd'` string — a record's date, or a template's default — and the
 * `[year, month, day]` triple with a one-based month, e.g. `[2026, 11, 21]`, which is how the fork
 * serialises a `LocalDate` inside a response body and how `GET /businessdate/BUSINESS_DATE`
 * answers.
 *
 * Every response model in the clients, loans and savings families imports this one name rather than
 * declaring a copy of its own, so the wire shape the three families describe cannot drift apart
 * (AAP 0.7.2 rows `Client`, `LoanAccount`, `SavingsAccount`).
 *
 * Deliberately a triple and not `readonly number[]`: only a triple names a day, while an array of
 * any length promises values no endpoint sends. `fromFineractDate` in this same file accepts
 * exactly these two shapes plus an already-parsed `Date`, so a wider type would promise values the
 * parser rejects.
 */
export type FineractDate = string | readonly [number, number, number];

/**
 * The one pattern for both a payload value and a rendered date: `dd MMMM yyyy`, e.g.
 * `21 November 2026`.
 *
 * Equal to `FINERACT_DATE_FORMAT`, which is also `AppConfig.dateFormat`, so a payload format and a
 * display format cannot drift apart. A component renders a date through this constant rather than
 * through a locale-defaulted `DatePipe` format, because the legacy screens show this pattern in
 * every language (Rule 1 clause 3).
 */
export const DISPLAY_DATE_FORMAT: string = FINERACT_DATE_FORMAT;

/**
 * Formats a field's date for a date-bearing Fineract payload, or reports that there is no date.
 *
 * The caller sends the result alongside `dateFormat: DISPLAY_DATE_FORMAT` and the body's `locale`
 * (AAP 0.7.3, "Rules that apply to every call"). A missing or invalid date yields `null` — never
 * `''`, `'Invalid Date'` or `'null'` — so a payload field is either a real date or absent, and the
 * server's own required-field rules are what reject the absence (Rule 1 clause 3).
 *
 * The month name is rendered in the language the payload will carry, so the value and the `locale`
 * beside it describe the same language (AAP 0.7.2, "Date handling": `dd MMMM yyyy` in the active
 * locale). A language the application ships no CLDR data for is reported as an error rather than
 * rendered in another language's month names — see `ensureLocaleData` in
 * `core/i18n/locale-data.ts`.
 *
 * @param value The date a form field holds, or `null`/`undefined` when the field is empty.
 * @param locale Locale code of the selected language, e.g. `'en'`; taken from
 * `AppConfigService.activeLocale`.
 * @returns `value` formatted as `dd MMMM yyyy`, or `null` when it is missing or invalid.
 * @throws Error when the application ships no locale data for `locale` or for its language subtag.
 */
export function toFineractDate(value: Date | null | undefined, locale: string): string | null {
  if (value === null || value === undefined || Number.isNaN(value.getTime())) {
    return null;
  }

  // Deliberate departure from legacy, registered in the AAP: the legacy AngularJS app loaded no
  // angular-locale bundle, so its date filter produced English month names beside a non-English
  // `locale`; AAP 0.7.2 "Date handling" requires the active locale instead. Registering the data
  // is what lets `formatDate` render the month name in that language, while `dateFormat` and
  // `locale` stay exactly the values legacy sent (Rule 1 clause 2).
  ensureLocaleData(locale);

  return formatDate(value, DISPLAY_DATE_FORMAT, locale);
}

/**
 * Reads a date Fineract returned into the local-midnight `Date` a field or a table cell holds: what
 * `GET /clients/{id}` sends as `'1988-03-14'`, what `GET /businessdate/BUSINESS_DATE` sends as
 * `[2026, 11, 21]`, and an already-parsed `Date`.
 *
 * The input is `unknown` because a response body is not modelled at the point a screen pulls one
 * date out of it; each accepted shape is narrowed by a guard below and every other value returns
 * `null` rather than throwing (Rule 1 clause 4). Nothing is guessed: a display-formatted string
 * such as `'21 November 2026'` is not an accepted shape, because accepting it would hide a response
 * shape that differs from the contract.
 *
 * Local midnight is built part by part, never from a bare `'yyyy-MM-dd'` string: `new Date()` reads
 * such a string as UTC midnight, which renders the previous day anywhere west of Greenwich, and that
 * shift would put an activation or a repayment on the wrong day.
 *
 * @param value A `FineractDate` — the `'yyyy-MM-dd'` string (a leading date part of an ISO string
 *   is read) or the `readonly [year, month, day]` triple — or an already-parsed `Date`.
 * @returns A new local-midnight `Date`, or `null` when `value` is not one of those shapes or names
 *   a calendar day that does not exist.
 */
export function fromFineractDate(value: unknown): Date | null {
  if (value instanceof Date) {
    // A copy, so a caller that later mutates its own instance cannot change what was parsed; an
    // invalid Date is still "no date".
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'string') {
    const leadingDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (leadingDate === null) {
      return null;
    }

    return fromCalendarParts(
      Number(leadingDate[1]),
      Number(leadingDate[2]),
      Number(leadingDate[3]),
    );
  }

  if (isDateTriple(value)) {
    const [year, month, day] = value;

    return fromCalendarParts(year, month, day);
  }

  return null;
}

/**
 * Narrows a `readonly [year, month, day]` number triple — the shape Fineract returns for a business
 * date and for a date inside a response body, with a one-based month. Integers only, because a
 * fractional part is not a calendar day.
 */
function isDateTriple(value: unknown): value is readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }

  const [year, month, day]: unknown[] = value;

  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day);
}

/**
 * Builds a local-midnight `Date` from a year, a one-based month and a day, or `null` when no
 * calendar holds that combination — `'2026-02-30'`, month 13 — instead of letting `Date` roll it
 * into the following month, which would report an event on a day the user never entered. The date
 * field's own input parser calls this too, so the two cannot disagree about which days exist.
 */
export function fromCalendarParts(year: number, month: number, day: number): Date | null {
  // The year is applied separately because the constructor maps a year of 0-99 to 1900-1999.
  const date = new Date(2000, month - 1, day);
  date.setFullYear(year);

  const namesSameDay =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return namesSameDay ? date : null;
}
