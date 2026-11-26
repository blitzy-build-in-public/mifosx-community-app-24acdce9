import { DecimalPipe } from '@angular/common';
import { computed, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { DISPLAY_DATE_FORMAT } from '../../../../shared/date-format.util';
import type { LoanTransaction } from '../../loan.models';
import { LoanTransactionsComponent } from './loan-transactions.component';

/**
 * Behaviour of the transactions section of the individual loan record — the read-only table of every
 * transaction Fineract reported for the loan (AAP 0.7.1 Features row `loans`; AAP 0.7.2 row
 * `LoanTransaction`; AAP 0.7.3 row "W6 repayment", whose record read is
 * `GET /loans/{id}?associations=all`; AAP 0.11.1 "unit specs beside every component"; Rule 1 clause 8,
 * "tests prove behaviour").
 *
 * It pins the three things this surface exists to do and that a rewrite would silently get wrong:
 *
 *  1. one row per transaction, in the order the API returned them, with each cell carrying the
 *     payload's own value — `type.value` verbatim because Fineract owns that label, the amounts as
 *     `DecimalPipe` renders them, and no row sorted, filtered, summed or recomputed (Rule 1 clause 3;
 *     AAP 0.10.2, where array order is meaningful and preserved);
 *  2. a loan with no transactions yet renders the shared explicit empty state and **no error**, which
 *     is the state AAP 0.7.4 requires of this list — an empty answer is a success, not a failure —
 *     including when the parent binds nothing at all and the input's own default applies;
 *  3. the date cell renders through the shared `DISPLAY_DATE_FORMAT` constant, from either Fineract
 *     date shape, and a value that is not a date renders empty rather than as an invalid date
 *     (AAP 0.7.2 "Date handling").
 *
 * **What is deliberately not asserted.** No sort control, total, subtotal, currency symbol or
 * recomputed balance, because the legacy tab has none of the last four and this migration adds no
 * capability legacy lacks (Rule 1 clause 3); no column beyond the seven the component declares; and
 * no request contract, because the component issues no request — the endpoints and their bodies are
 * proven once in `loan.service.spec.ts`.
 *
 * **Providers.** Only the translate stack: ngx-translate 18 declares `TranslateService` without
 * `providedIn`, so `TranslatePipe`'s injection fails without it, and the double below echoes every key
 * so no asset is ever fetched and each heading assertion compares a deterministic string. No
 * `HttpClient`, no `provideHttpClient` and no `HttpTestingController` appears here, which is itself the
 * proof that the component makes no call of its own (Rule 1 clause 5).
 *
 * **Fixtures.** Synthetic and deliberately unmistakable: the ids descend (7 then 3) while the amounts
 * ascend, so a component that sorted by id would be invisible while one that sorted by amount would
 * move a row. No credential, tenant datum, authentication key or client name appears (Rule 1 clause 9),
 * and no host or URL literal appears at all (Rule 2).
 */

/**
 * The key the template hands the empty state (`'label.nodata'` in
 * `loan-transactions.component.html`): the legacy bundles' own "No Data" key, which is what the
 * shipped template resolves. The double below echoes it, so the assertion compares the key the
 * component asks for without pinning a locale bundle's wording (Rule 1 clause 6).
 */
const NO_DATA_KEY = 'label.nodata';

/**
 * The ledger row a disbursement produces: the transaction that opened the loan, carrying the
 * `[year, month, day]` triple Fineract sends inside a response body.
 */
const DISBURSEMENT: LoanTransaction = {
  id: 7,
  date: [2026, 11, 21],
  type: { id: 1, code: 'loanTransactionType.disbursement', value: 'Disbursement' },
  amount: 1000,
  principalPortion: 1000,
  interestPortion: 0,
  feeChargesPortion: 0,
  penaltyChargesPortion: 0,
  outstandingLoanBalance: 5000,
  manuallyReversed: false,
};

/**
 * The ledger row a repayment produces: a fractional amount with its own principal and interest split,
 * dated as the `'yyyy-MM-dd'` string a record's date arrives in.
 */
const REPAYMENT: LoanTransaction = {
  id: 3,
  date: '2026-11-22',
  type: { id: 2, code: 'loanTransactionType.repayment', value: 'Repayment' },
  amount: 250.5,
  principalPortion: 240.5,
  interestPortion: 10,
  feeChargesPortion: 0,
  penaltyChargesPortion: 0,
  outstandingLoanBalance: 4749.5,
  manuallyReversed: false,
};

/** The disbursement again, dated as the ISO string Fineract also sends, for the date-shape case. */
const ISO_DATED: LoanTransaction = { ...DISBURSEMENT, id: 8, date: '2026-11-21' };

/** A row whose date is not one of the two shapes Fineract sends, for the unparsable-date case. */
const MALFORMED_DATE: LoanTransaction = { ...REPAYMENT, id: 4, date: 'not-a-fineract-date' };

/**
 * The ngx-translate surface this section touches: the `translate()` signal `TranslatePipe` 18 resolves
 * its keys through, and the members this family's components read from the same service. Every key
 * resolves to itself. Typed rather than `any` (Rule 1 clause 4) and reaching no network.
 */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}

/** Builds the translation double the TestBed provides; every key resolves to itself. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => key,
    translate: (key: string): Signal<string> => computed(() => key),
    onLangChange: new Observable<never>(),
    onTranslationChange: new Observable<never>(),
  };
}

/**
 * `DecimalPipe` at the test module's `LOCALE_ID` — the locale the component's own `number` pipe
 * resolves to when no provider overrides it — so an expected amount is what the shipped pipe produces
 * instead of a hand-written guess about where its separators fall.
 */
const DECIMAL = new DecimalPipe('en-US');

/** How the `number` pipe renders one amount (AAP 0.7.2: amounts are the payload's own numbers). */
function amount(value: number): string {
  return DECIMAL.transform(value) ?? '';
}

/**
 * Mounts the section with the transactions the parent would bind, and renders it once.
 *
 * Angular types `fixture.nativeElement` loosely, so the `as HTMLElement` cast here and in
 * `renderUnbound` below are this spec's only type boundaries; every assertion is then made on the
 * rendered DOM, which is what the user and the parity run observe (Rule 1 clauses 4 and 8).
 */
function render(transactions: readonly LoanTransaction[]): HTMLElement {
  const fixture = TestBed.createComponent(LoanTransactionsComponent);
  fixture.componentRef.setInput('transactions', transactions);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/**
 * Mounts the section without binding anything, so the input's own default applies: the state a parent
 * that read a loan carrying no `transactions` member renders.
 */
function renderUnbound(): HTMLElement {
  const fixture = TestBed.createComponent(LoanTransactionsComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** The header cells' text, in document order. */
function headings(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('thead th')).map((cell) => (cell.textContent ?? '').trim());
}

/** Every body row's cell text, in document order, so row order and column assignment are both visible. */
function rows(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').trim()),
  );
}

/** The one transactions table, or an error naming the hook the template must expose. */
function table(host: HTMLElement): HTMLTableElement {
  const found = host.querySelector('table#loan-transactions');

  if (!(found instanceof HTMLTableElement)) {
    throw new Error('the populated state must render the table at table#loan-transactions');
  }

  return found;
}

/** The one empty state, or an error naming the hook the template must expose. */
function emptyState(host: HTMLElement): Element {
  const found = host.querySelector('app-empty-state#loan-transactions-empty');

  if (found === null) {
    throw new Error('the empty state must render at app-empty-state#loan-transactions-empty');
  }

  return found;
}

describe('LoanTransactionsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoanTransactionsComponent],
      providers: [{ provide: TranslateService, useValue: translateStub() }],
    }).compileComponents();
  });

  it('renders the seven column headings in the order the table declares them', () => {
    const host = render([DISBURSEMENT]);

    // The headings are the legacy bundle's keys, echoed by the double: this pins which columns exist
    // and their order, without pinning a translated sentence (Rule 1 clause 6).
    expect(headings(host)).toEqual([
      'label.heading.date',
      'label.heading.type',
      'label.heading.amount',
      'label.heading.principal',
      'label.heading.interest',
      'label.heading.fees',
      'label.heading.outstanding',
    ]);
    expect(host.querySelectorAll('thead th')).toHaveLength(7);
  });

  it('renders one row per transaction carrying the payload’s own values in the API order', () => {
    // The ids descend (7 then 3) while the amounts ascend, so an id sort would be invisible and an
    // amount sort would move a row: neither may happen (Rule 1 clause 3; AAP 0.10.2).
    const host = render([DISBURSEMENT, REPAYMENT]);

    expect(rows(host)).toEqual([
      [
        '21 November 2026',
        'Disbursement',
        amount(1000),
        amount(1000),
        amount(0),
        amount(0),
        amount(5000),
      ],
      ['22 November 2026', 'Repayment', amount(250.5), amount(240.5), amount(10), amount(0), amount(4749.5)],
    ]);

    // The amounts appear in the order the array was given: the component applies no sort.
    expect(rows(host).map((cells) => cells[2])).toEqual([amount(1000), amount(250.5)]);
  });

  it('renders exactly one striped table and no empty state when the loan has transactions', () => {
    const host = render([DISBURSEMENT]);

    expect(host.querySelectorAll('table#loan-transactions')).toHaveLength(1);
    expect(table(host).classList.contains('table')).toBe(true);
    expect(table(host).classList.contains('table-striped')).toBe(true);
    expect(host.querySelector('app-empty-state')).toBeNull();
  });

  it('renders the shared explicit empty state, and no table, when the loan has no transactions', () => {
    const host = render([]);

    // The empty state is the shared component, not copy written for this table, and it carries the key
    // the legacy bundles hold for "No Data" (AAP 0.7.4; Rule 1 clauses 3 and 6).
    expect(host.querySelectorAll('app-empty-state#loan-transactions-empty')).toHaveLength(1);
    expect((emptyState(host).textContent ?? '').trim()).toBe(NO_DATA_KEY);

    // No empty table frame is left behind: the two branches are exclusive.
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelectorAll('th, td')).toHaveLength(0);
  });

  it('renders the empty state with no error region anywhere in the section', () => {
    const host = render([]);

    // An empty answer is a success, not a failure: no alert, no danger text, no alert role, either on
    // the section or inside the empty state it renders (AAP 0.7.4).
    expect(host.querySelector('.alert, .alert-danger, .text-danger, [role="alert"]')).toBeNull();
    expect(emptyState(host).querySelector('.alert, .text-danger, [role="alert"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain('Invalid');
  });

  it('renders the empty state when the parent binds no transactions at all', () => {
    // A loan whose record read carries no `transactions` member hands the section nothing, and the
    // input's own default of an empty list is what that must render (AAP 0.7.4).
    const host = renderUnbound();

    expect((emptyState(host).textContent ?? '').trim()).toBe(NO_DATA_KEY);
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.alert, .alert-danger, .text-danger, [role="alert"]')).toBeNull();
  });

  it('renders both Fineract date shapes through the shared display pattern', () => {
    // The one display pattern the application has, asserted here so a change to the shared constant
    // cannot silently pass this spec (AAP 0.7.2 "Date handling").
    expect(DISPLAY_DATE_FORMAT).toBe('dd MMMM yyyy');

    const host = render([DISBURSEMENT, ISO_DATED]);

    // The triple and the `'yyyy-MM-dd'` string name the same day and render the same way, which is
    // what proves the cell formats through `fromFineractDate` plus the shared constant.
    expect(rows(host).map((cells) => cells[0])).toEqual(['21 November 2026', '21 November 2026']);
  });

  it('renders an unparsable date as an empty cell rather than an invalid date', () => {
    const host = render([MALFORMED_DATE]);

    // One row is still rendered — the transaction is real — and only its date cell is empty, because a
    // value that is not a date parses to nothing and the pipe then paints nothing (AAP 0.7.2).
    expect(rows(host)).toHaveLength(1);
    expect(rows(host)[0]?.[0]).toBe('');
    expect(host.textContent ?? '').not.toContain('Invalid');
  });
});
