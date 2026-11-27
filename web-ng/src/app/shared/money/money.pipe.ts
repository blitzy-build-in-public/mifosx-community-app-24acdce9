/** The one rendering of a money figure the application shows, in place of a bare `DecimalPipe` per template (AAP 0.7.1 `shared/**`, AAP 0.7.4, AAP 0.14.1, Rule 1 clause 3). */
import { formatNumber } from '@angular/common';
import { LOCALE_ID, Pipe, inject, type PipeTransform } from '@angular/core';

import { ensureLocaleData } from '../../core/i18n/locale-data';

/** The currency object a Fineract payload reports for the money it carries — `GET /loans/{id}?associations=all` sends it at the top level, on `repaymentSchedule` and inside every `charges[]` entry, and `GET /clients/{id}/accounts` sends it on each `loanAccounts[]` entry, as `{code: "USD", name: "US Dollar", decimalPlaces: 2, displaySymbol: "$", displayLabel: "US Dollar ($)"}`. Every member is optional because a reader states only what it renders and a payload that omits one is still a currency (Rule 1 clause 4, AAP 0.7.2). */
export interface MoneyCurrency {
  /** ISO code the currency is denominated in, e.g. `USD`. Declared so the payload's currency is modelled whole; never printed, because the legacy screens print the symbol and never the code (Rule 1 clause 3). */
  readonly code?: string;
  /** The currency's name, e.g. `US Dollar`. Declared for the same reason as {@link code}; never printed. */
  readonly name?: string;
  /** The symbol printed immediately before the figure, e.g. `$` — the member the legacy templates prefix and the only one this pipe renders (Rule 1 clause 3). */
  readonly displaySymbol?: string;
  /** Digits after the decimal point the currency is defined with, e.g. `2`. Deliberately **not** applied: see {@link MoneyPipe} (Rule 1 clause 3). */
  readonly decimalPlaces?: number;
}

/** The digits every money figure is rendered at — `1.0-3`, meaning grouping every three integer digits, no minimum fraction digit and at most three. It is the default `DecimalPipe` (`| number`) uses, which is the filter the legacy templates apply to every one of these figures, so a figure that rendered `5,000`, `25`, `416.67` or `1,250.5` there renders byte-identically here (AAP 0.10.2, Rule 1 clause 3). */
const MONEY_DIGITS = '1.0-3';

/** Renders one money figure the way the legacy screens render it: the figure through the `number` filter's own digits, prefixed with the currency's `displaySymbol` when the payload reported one.
 * Two constraints decide the shape, and both are parity rather than preference (Rule 1 clause 3): - **Where the symbol appears.** The legacy record prints it on the loan's charge amounts (`app/views/loans/viewloanaccountdetails.html:854-857`) and on the balance heading above its summary grid (`:125`), and prints the summary grid's own cells, the repayment schedule, the application's preview and the client record's account balances without it (`:145-190`, `:540-560`, `app/views/loans/previewloanrepaymentschedule.html:52-58`, `app/views/loans/newloanaccount.html:793-806`, `app/views/clients/viewclient.html:349,446,560`). Callers therefore pass the payload's currency on the two surfaces where
 * legacy states one and pass none on the others, so the application prints the symbol exactly where legacy prints it. - **How the symbol is spaced.** Legacy itself sets two precedents: no space in its charge table (`:854`, `$25`) and one space on its balance heading (`:125`, `$ 5,200`). One shared formatter cannot reproduce both, so it takes the charge table's no-space form and every call site that departs from `:125` says so where it calls. - **How precise the figure is.** {@link MoneyCurrency.decimalPlaces} is never applied. Legacy formats every one of these figures through AngularJS's `number` filter, whose default fraction size governs the precision (minimum 0, maximum 3), so `25` renders
 * `$25` and `416.6666` renders `$416.667`. A fixed two-decimal format — what `decimalPlaces: 2` would give — would be a deliberate difference from legacy that AAP 0.10.5 does not register among its 16 differences, and Rule 1 clause 3 allows no unregistered one. */
@Pipe({
  name: 'money',
  standalone: true,
  pure: true,
})
export class MoneyPipe implements PipeTransform {
  /** The language whose grouping and decimal separator the figure is rendered in: the application's `LOCALE_ID`, so a money figure groups the way the dates on the same screen word their months (AAP 0.7.2 "Date handling"). */
  private readonly locale: string = inject(LOCALE_ID);

  /** Formats `value` for the screen, or reports that there is no figure. @param value The figure the payload reported, or `null`/`undefined` when it reported none. @param currency The currency the payload reported for that figure, when the surface
   * prints one. @returns The figure with the currency's symbol in front of it, or the bare figure, or `null` — which the template renders as an empty cell, never as a zero or a `NaN` the payload never carried (Rule 1 clause 3). */
  transform(value: number | null | undefined, currency?: MoneyCurrency | null): string | null {
    // A figure that is absent or not a number has no rendering: `NaN` would otherwise print as "NaN", and the four states that reach this guard are a payload that omitted the member, a `null` the API sent instead of a number, `NaN` and an infinity.
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }

    // `formatNumber` takes its separators and digits from CLDR data, and throws `NG0701` for a language whose data was never registered, so the locale is registered first — the same call, and the same reason, as the shared date formatter (`shared/date-format.util.ts`) (AAP 0.7.3).
    ensureLocaleData(this.locale);

    const figure = formatNumber(value, this.locale, MONEY_DIGITS);

    // The symbol is prefixed with no space, exactly as the legacy template concatenates it (`viewloanaccountdetails.html:854`). A payload whose currency carries no symbol — or an empty one — leaves the figure bare, which is what those same legacy surfaces show when the field is absent.
    const symbol = currency?.displaySymbol;

    return typeof symbol === 'string' && symbol.length > 0 ? `${symbol}${figure}` : figure;
  }
}
