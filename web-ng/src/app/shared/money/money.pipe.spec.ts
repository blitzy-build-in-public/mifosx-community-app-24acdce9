import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MoneyPipe, type MoneyCurrency } from './money.pipe';

/** Behaviour of the one money formatter the five amount surfaces share: the figure it prints, the symbol it prefixes, and the states it reports as no figure at all (AAP 0.7.1 `shared/**`, AAP 0.7.4, AAP 0.10.2, Rule 1 clause 3, Rule 1 clause 8). */

/** The locale the pipe is built with. Pinned so thousands grouping and the decimal point are the expectations below on any host, under any default locale. */
const SPEC_LOCALE = 'en-US';

/** The currency `GET /loans/{id}?associations=all` reports for the loan it returns, member for member — its `decimalPlaces` included, which the pipe deliberately does not apply (Rule 1 clause 3). */
const CURRENCY: MoneyCurrency = {
  code: 'USD',
  name: 'US Dollar',
  displaySymbol: '$',
  decimalPlaces: 2,
};

/** The figures a surface prints with the currency in front of them, paired with what the legacy charge table renders: the symbol immediately before the figure, no space between them, and the `number` filter's own digits — integers bare, fractions up to three decimals, grouping every three integer digits, and a zero printed as a figure (`viewloanaccountdetails.html:854-857`). That table is the no-space precedent the pipe shares; legacy's balance heading sets the other one, one space (`:125`, `$ 5,200`), and the loan record's summary block names that departure where it calls the pipe. The smallest integer case carries `decimalPlaces: 2` in {@link CURRENCY} and still renders `$25`, which is the precision decision stated in the pipe. */
const SYMBOL_CASES: readonly (readonly [number, string])[] = [
  [25, '$25'],
  [5725, '$5,725'],
  [416.67, '$416.67'],
  [0, '$0'],
  [-5000, '$-5,000'],
  [1250.5, '$1,250.5'],
  [416.667, '$416.667'],
  [1250.1234, '$1,250.123'],
];

/** The same figures on the four surfaces the legacy templates print without a symbol — the repayment schedule, the application's preview and the client record's account balances — which pass no currency and must be untouched by the change (Rule 1 clause 3). */
const BARE_CASES: readonly (readonly [number, string])[] = [
  [25, '25'],
  [5725, '5,725'],
  [416.67, '416.67'],
  [0, '0'],
  [-5000, '-5,000'],
  [1250.5, '1,250.5'],
  [416.6666, '416.667'],
];

/** The currency values that leave the figure bare: a caller passing none, an explicit `null`, a payload whose `displaySymbol` is an empty string, and a currency that carries only its code and precision. */
const SYMBOLLESS_CURRENCIES: readonly (readonly [string, MoneyCurrency | null | undefined])[] = [
  ['no currency at all', undefined],
  ['a null currency', null],
  ['a currency whose displaySymbol is empty', { displaySymbol: '' }],
  ['a currency carrying only a code and its precision', { code: 'USD', decimalPlaces: 2 }],
];

/** The values that are not a figure, labelled for the test's own message: the two empty states the templates can hand the pipe, and the three numbers that are not finite, which `formatNumber` would otherwise print as `NaN` or `∞`. */
const ABSENT_CASES: readonly (readonly [string, number | null | undefined])[] = [
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
];

describe('MoneyPipe', () => {
  let pipe: MoneyPipe;

  /** Builds the pipe the way the framework does — inside an injection context, so its `LOCALE_ID` resolves — for each case. */
  function createPipe(): MoneyPipe {
    return TestBed.runInInjectionContext(() => new MoneyPipe());
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: LOCALE_ID, useValue: SPEC_LOCALE }] });
    pipe = createPipe();
  });

  it.each(SYMBOL_CASES)('prints %d as %s with the currency the payload reported', (value, expected) => {
    expect(pipe.transform(value, CURRENCY)).toBe(expected);
  });

  it.each(BARE_CASES)('prints %d as %s when the surface shows no currency', (value, expected) => {
    expect(pipe.transform(value)).toBe(expected);
  });

  it.each(SYMBOLLESS_CURRENCIES)('prints the figure bare for %s', (_label, currency) => {
    expect(pipe.transform(1250.5, currency)).toBe('1,250.5');
  });

  it.each(ABSENT_CASES)('reports no figure for %s', (_label, value) => {
    // `null` rather than an empty string, so the template's interpolation renders nothing at all: no `NaN`, no `∞`, no dash and no zero the payload never carried.
    expect(pipe.transform(value, CURRENCY)).toBeNull();
  });
});
