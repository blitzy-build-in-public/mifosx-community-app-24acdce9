import { DecimalPipe } from '@angular/common';
import { computed, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DISPLAY_DATE_FORMAT } from '../../../../shared/date-format.util';
import type { LoanTransaction } from '../../loan.models';
import { LoanTransactionsComponent } from './loan-transactions.component';

/** Behaviour of the record's transactions section — the read-only table of every transaction Fineract reported (AAP 0.7.1 `loans`; AAP 0.7.2 `LoanTransaction`; AAP 0.7.3 "W6 repayment", whose record read is `GET /loans/{id}?associations=all"; Rule 1 clause 8): one row per transaction in the API's order with the payload's own values, the shared empty state and no error for a loan with none, and every date at the shared `DISPLAY_DATE_FORMAT`. */

// The key the template hands the empty state, `'label.nodata'` from the legacy bundles — the key the component asks for, never a bundle's wording (Rule 1 clause 6).
const NO_DATA_KEY = 'label.nodata';
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
const ISO_DATED: LoanTransaction = { ...DISBURSEMENT, id: 8, date: '2026-11-21' };
const MALFORMED_DATE: LoanTransaction = { ...REPAYMENT, id: 4, date: 'not-a-fineract-date' };
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: Observable<unknown>;
  readonly onTranslationChange: Observable<unknown>;
}
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => key,
    translate: (key: string): Signal<string> => computed(() => key),
    onLangChange: new Observable<never>(),
    onTranslationChange: new Observable<never>(),
  };
}
const DECIMAL = new DecimalPipe('en-US');
function amount(value: number): string {
  return DECIMAL.transform(value) ?? '';
}
function render(transactions: readonly LoanTransaction[]): HTMLElement {
  const fixture = TestBed.createComponent(LoanTransactionsComponent);
  fixture.componentRef.setInput('transactions', transactions);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}
function renderUnbound(): HTMLElement {
  const fixture = TestBed.createComponent(LoanTransactionsComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}
function headings(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('thead th')).map((cell) => (cell.textContent ?? '').trim());
}
function rows(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').trim()),
  );
}
function table(host: HTMLElement): HTMLTableElement {
  const found = host.querySelector('table#loan-transactions');
  if (!(found instanceof HTMLTableElement)) {
    throw new Error('the populated state must render the table at table#loan-transactions');
  }
  return found;
}
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
// The ids descend (7 then 3) while the amounts ascend, so an id sort would be invisible and an amount sort would move a row: neither may happen (Rule 1 clause 3; AAP 0.10.2).
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
    expect(rows(host).map((cells) => cells[2])).toEqual([amount(1000), amount(250.5)]);
  });
  it('renders exactly one striped table and no empty state when the loan has transactions', () => {
    const host = render([DISBURSEMENT]);
    expect(host.querySelectorAll('table#loan-transactions')).toHaveLength(1);
    expect(table(host).classList.contains('table')).toBe(true);
    expect(table(host).classList.contains('table-striped')).toBe(true);
    expect(host.querySelector('app-empty-state')).toBeNull();
  });
  it('names the table with the transactions heading through a visually hidden caption', () => {
    const host = render([DISBURSEMENT]);
    const caption = table(host).querySelector('caption');
    // The caption is the table's own naming element and Bootstrap's `.sr-only` keeps it off the screen, so the
    // table is announced by the legacy bundle's transactions heading without a pixel moving.
    expect(caption?.textContent?.trim()).toBe('label.heading.transactions');
    expect(caption?.classList.contains('sr-only')).toBe(true);
    expect(table(host).firstElementChild).toBe(caption);
  });
  it('renders the shared explicit empty state, and no table, when the loan has no transactions', () => {
    const host = render([]);
    expect(host.querySelectorAll('app-empty-state#loan-transactions-empty')).toHaveLength(1);
    expect((emptyState(host).textContent ?? '').trim()).toBe(NO_DATA_KEY);
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelectorAll('th, td')).toHaveLength(0);
  });
  it('renders the empty state with no error region anywhere in the section', () => {
    const host = render([]);
    expect(host.querySelector('.alert, .alert-danger, .text-danger, [role="alert"]')).toBeNull();
    expect(emptyState(host).querySelector('.alert, .text-danger, [role="alert"]')).toBeNull();
    expect(host.textContent ?? '').not.toContain('Invalid');
  });
  it('renders the empty state when the parent binds no transactions at all', () => {
    const host = renderUnbound();
    expect((emptyState(host).textContent ?? '').trim()).toBe(NO_DATA_KEY);
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.alert, .alert-danger, .text-danger, [role="alert"]')).toBeNull();
  });
  it('renders both Fineract date shapes through the shared display pattern', () => {
// The one display pattern the application has, asserted here so a change to the shared constant cannot silently pass this spec (AAP 0.7.2 "Date handling").
    expect(DISPLAY_DATE_FORMAT).toBe('dd MMMM yyyy');
    const host = render([DISBURSEMENT, ISO_DATED]);
    expect(rows(host).map((cells) => cells[0])).toEqual(['21 November 2026', '21 November 2026']);
  });
  it('renders an unparsable date as an empty cell rather than an invalid date', () => {
    const host = render([MALFORMED_DATE]);
    expect(rows(host)).toHaveLength(1);
    expect(rows(host)[0]?.[0]).toBe('');
    expect(host.textContent ?? '').not.toContain('Invalid');
  });
});
