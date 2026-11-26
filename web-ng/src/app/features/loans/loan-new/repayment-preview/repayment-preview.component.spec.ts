import { LOCALE_ID } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';
import { RepaymentPreviewComponent } from './repayment-preview.component';

/** Behavioural spec for the loan application's repayment schedule preview: the table the applicant reads after `POST /loans?command=calculateLoanSchedule` returns before anything is submitted (AAP 0.7.1 Features row `loans` — "`LoanNewComponent` (with `RepaymentPreviewComponent`)"; AAP 0.7.4 "`#/newclientloanaccount/:clientId` presents the product and terms fields from the loan template with a 'Preview schedule' action that posts `calculateLoanSchedule` and renders the returned periods as a table"; AAP 0.11.1, AAP 0.14.1, AAP 0.14.2). */

const SPEC_LANG = 'en';

/** Locale `DatePipe` and `DecimalPipe` format with. Pinned so month names, thousands separators and the decimal point are the assertions below, on any host, under any default locale. */
const SPEC_LOCALE = 'en-US';

const COLUMN_KEYS: readonly string[] = [
  'label.heading.no',
  'label.heading.fromdate',
  'label.heading.date',
  'label.heading.principal',
  'label.heading.balanceofloan',
  'label.heading.interest',
  'label.heading.fees',
  'label.heading.total',
  'label.heading.outstanding',
];

const COLUMN_LABELS: Readonly<Record<string, string>> = {
  'label.heading.no': 'No.',
  'label.heading.fromdate': 'From Date',
  'label.heading.date': 'Due Date',
  'label.heading.principal': 'Principal',
  'label.heading.balanceofloan': 'Balance of Loan',
  'label.heading.interest': 'Interest',
  'label.heading.fees': 'Fees',
  'label.heading.total': 'Total',
  'label.heading.outstanding': 'Outstanding',
};

const EMPTY_STATE_KEY = 'label.nodata';

const EMPTY_STATE_TEXT = 'No repayment schedule has been calculated.';

/** The in-memory translation bundle. It covers the ten keys the template uses — the nine headers and the no-data label — and nothing else, so serving it is what proves the template's keys are the ones the legacy bundle (AAP 0.10.2). */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  ...COLUMN_LABELS,
  [EMPTY_STATE_KEY]: EMPTY_STATE_TEXT,
  // The table's accessible name, from the legacy bundle's own schedule heading.
  'label.heading.repaymentschedule': 'Repayment Schedule',
};

/** A complete `RepaymentPeriod`, with every member the model declares supplied on purpose: a member the model gains later breaks this factory at compile time instead of passing silently, which is the point of filling it (Rule 1 clause 4). */
function makePeriod(
  overrides: Partial<RepaymentPeriod> = {},
  periodNumber: number | null = 1,
): RepaymentPeriod {
  return {
    ...(periodNumber === null ? {} : { period: periodNumber }),
    fromDate: '2026-11-21',
    dueDate: [2026, 12, 21],
    principalDue: 416.67,
    principalOriginalDue: 416.67,
    interestDue: 50,
    feeChargesDue: 0,
    penaltyChargesDue: 0,
    totalDueForPeriod: 466.67,
    totalOriginalDueForPeriod: 466.67,
    principalOutstanding: 4583.33,
    principalLoanBalanceOutstanding: 4583.33,
    interestOutstanding: 550,
    totalOutstandingForPeriod: 5133.33,
    complete: false,
    ...overrides,
  };
}

/** A complete `RepaymentSchedule`: its ordered periods plus every total the model declares, supplied for the same reason as `makePeriod` — the totals are optional on the wire, and the preview renders none of them, so their presence here proves the table shows the periods and not a computed total. */
function makeSchedule(periods: readonly RepaymentPeriod[]): RepaymentSchedule {
  return {
    periods,
    totalPrincipalDisbursed: 5000,
    totalPrincipalExpected: 5000,
    totalInterestCharged: 600,
    totalFeeChargesCharged: 25,
    totalRepaymentExpected: 5625,
    loanTermInDays: 395,
  };
}

/** A `RepaymentPeriod` as the wire sends the preview's leading row: the fork's disbursement pseudo-period carries no `period` member (see `RepaymentPeriod`), so the object is built without that key rather than with a substitute, because the model declares the member optional — the statement this helper keeps honest. */
function makeUnnumberedPeriod(overrides: Partial<RepaymentPeriod> = {}): RepaymentPeriod {
  return makePeriod(overrides, null);
}

/** An element's text with runs of whitespace collapsed to one space and the ends trimmed, so the template's own indentation cannot mislead an assertion. */
function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('RepaymentPreviewComponent', () => {
  // The spec deliberately registers no HTTP provider, no HTTP testing controller and no routing: the preview is a pure projection of its input, so the injector below is the translate stack and the locale and nothing more (Rule 1 clause 5, Rule 1 clause 8, Rule 2).

  function hostOf(fixture: ComponentFixture<RepaymentPreviewComponent>): HTMLElement {
    // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps every element the helpers return an `HTMLElement` and confines the cast to this single boundary (Rule 1 clause 4).
    return fixture.nativeElement as HTMLElement;
  }

  /** The preview table, or `null` while the component renders the empty state. */
  function tableOf(host: HTMLElement): HTMLTableElement | null {
    return host.querySelector<HTMLTableElement>('table#repayment-preview');
  }

  function headerCells(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('table#repayment-preview thead tr th'));
  }

  function bodyRows(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('table#repayment-preview tbody tr'));
  }

  function cellsOf(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>('td'));
  }

  function renderedCells(host: HTMLElement): string[][] {
    return bodyRows(host).map((row) => cellsOf(row).map((cell) => textOf(cell)));
  }

  /** The shared empty-state element, or `null` when the table is rendered instead. */
  function emptyStateOf(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>('app-empty-state#repayment-preview-empty');
  }

  /** Renders the component bound to `schedule`. The input is set before the first change detection, then the fixture is stabilised and checked again: `TranslatePipe` is impure, so a header label is read through the template on every pass, and the assertions must follow the pass that resolves the bundle rather than the one that renders the markup. */
  async function render(
    schedule: RepaymentSchedule | null,
  ): Promise<ComponentFixture<RepaymentPreviewComponent>> {
    const fixture = TestBed.createComponent(RepaymentPreviewComponent);

    fixture.componentRef.setInput('schedule', schedule);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  beforeEach(async () => {
    // `provideTranslateService()` registers the translate stack with its no-op loader, so nothing is fetched: the labels are the in-memory bundle served below (Rule 1 clause 5).
    await TestBed.configureTestingModule({
      imports: [RepaymentPreviewComponent],
      providers: [
        provideTranslateService({ lang: SPEC_LANG }),
        { provide: LOCALE_ID, useValue: SPEC_LOCALE },
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);

    translate.setTranslation(SPEC_LANG, TRANSLATIONS, true);
    translate.use(SPEC_LANG);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one table row per period, under the nine schedule columns', async () => {
    const schedule = makeSchedule([
      makePeriod({ period: 1 }),
      makePeriod({ period: 2 }),
      makePeriod({ period: 3 }),
    ]);
    const host = hostOf(await render(schedule));
    const rows = bodyRows(host);
    const labels = headerCells(host).map((cell) => textOf(cell));

    expect(tableOf(host)).not.toBeNull();
    expect(labels).toEqual(COLUMN_KEYS.map((key) => COLUMN_LABELS[key]));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => cellsOf(row).length)).toEqual([9, 9, 9]);

    // Every header label resolved: no raw dotted key reaches the user (AAP 0.10.2).
    for (const key of COLUMN_KEYS) {
      expect(textOf(host)).not.toContain(key);
    }
  });

  it('keeps the period order the server sent instead of sorting it', async () => {
    // Out of numeric order on purpose: the array is the schedule's sequence, and the preview is not allowed to reorder what Fineract calculated (Rule 1 clause 3).
    const fixture = await render(
      makeSchedule([
        makePeriod({ period: 3 }),
        makePeriod({ period: 1 }),
        makePeriod({ period: 2 }),
      ]),
    );

    expect(renderedCells(hostOf(fixture)).map((cells) => cells[0])).toEqual(['3', '1', '2']);
  });

  /** Locks down contract-loan-period-required-false: the fork's leading disbursement pseudo-period carries no `period` member, so the model declares it optional and the preview keys its rows by position — two unnumbered rows in one schedule would otherwise repeat the same absent key, while the period cell prints what the payload sent, which for those rows is nothing. */
  it('renders an unnumbered disbursement row with an empty period cell, one row per period', async () => {
    // Angular reports a duplicated track key through `console.warn` in dev mode and renders on, so the console is the observable a positional track has to keep quiet: `track period.period` emits NG0955 for the two unnumbered.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const periods: readonly RepaymentPeriod[] = [
      makeUnnumberedPeriod({ dueDate: '2026-11-24' }),
      makePeriod({ period: 1 }),
      makeUnnumberedPeriod({ dueDate: '2026-12-24' }),
      makePeriod({ period: 2 }),
    ];
    const fixture = await render(makeSchedule(periods));
    const rows = renderedCells(hostOf(fixture));

    expect(rows).toHaveLength(4);
    // The unnumbered rows print an empty cell — no 0, no dash, no renumbering of the periods below them — and the numbered rows keep their own numbers in the server's order (Rule 1 clause 3).
    expect(rows.map((cells) => cells[0])).toEqual(['', '1', '', '2']);
    expect(rows.filter((cells) => cells[0] === '')).toHaveLength(2);

    fixture.componentRef.setInput('schedule', makeSchedule([...periods]));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(renderedCells(hostOf(fixture)).map((cells) => cells[0])).toEqual(['', '1', '', '2']);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('NG0955'))).toHaveLength(0);
  });

  it('renders a period date as dd MMMM yyyy', async () => {
    // The two shapes a Fineract response sends a date in, both accepted by `fromFineractDate`: the `'yyyy-MM-dd'` string, and the `[year, month, day]` triple with a one-based month.
    const fixture = await render(
      makeSchedule([makePeriod({ fromDate: [2026, 11, 21], dueDate: '2026-12-05' })]),
    );
    const [cells] = renderedCells(hostOf(fixture));

    expect(cells[1]).toBe('21 November 2026');
    expect(cells[2]).toBe('05 December 2026');
  });

  it('renders a period date the wire parser rejects as an empty cell, never an invalid date', async () => {
    // A response value that names no calendar day — here a string with no `yyyy-MM-dd` date part, which `fromFineractDate` rejects — must leave the cell empty rather than print `Invalid Date`.
    const fixture = await render(makeSchedule([makePeriod({ fromDate: 'not-a-date' })]));
    const [cells] = renderedCells(hostOf(fixture));

    expect(cells[1]).toBe('');
    expect(cells[2]).toBe('21 December 2026');
    expect(textOf(hostOf(fixture))).not.toContain('Invalid Date');
  });

  it('renders each amount as the payload sent it, and totals nothing itself', async () => {
    const fixture = await render(
      makeSchedule([
        makePeriod({
          principalDue: 1234.5,
          principalLoanBalanceOutstanding: 4567.89,
          interestDue: 65.5,
          feeChargesDue: 25,
          totalDueForPeriod: 5000,
          totalOutstandingForPeriod: 8765.43,
        }),
      ]),
    );
    const [cells] = renderedCells(hostOf(fixture));

    // Grouping and the payload's own fraction digits, with no forced decimals: the default `number` pipe the record page's schedule table and legacy's own `number` filter use, so 5000 reads 5,000 here exactly as it does there (Rule 1 clause 3, AAP 0.10.2).
    expect(cells[3]).toBe('1,234.5');
    expect(cells[4]).toBe('4,567.89');
    expect(cells[5]).toBe('65.5');
    expect(cells[6]).toBe('25');
    expect(cells[7]).toBe('5,000');

    expect(cells[7]).not.toBe('1,325');
    expect(cells[8]).toBe('8,765.43');
  });

  it('names the table with the schedule heading through a visually hidden caption', async () => {
    const host = hostOf(await render(makeSchedule([makePeriod()])));
    const caption = tableOf(host)?.querySelector('caption');

    // The caption is the table's own naming element and Bootstrap's `.sr-only` keeps it off the screen, so the preview is announced by the legacy bundle's schedule heading without a pixel moving.
    expect(textOf(caption ?? null)).toBe(TRANSLATIONS['label.heading.repaymentschedule']);
    expect(caption?.classList.contains('sr-only')).toBe(true);
    expect(tableOf(host)?.firstElementChild).toBe(caption);
  });

  it('renders the explicit empty state before any schedule has been calculated', async () => {
    const fixture = await render(null);
    const host = hostOf(fixture);
    const emptyState = emptyStateOf(host);

    expect(emptyState).not.toBeNull();
    expect(textOf(emptyState)).toBe(EMPTY_STATE_TEXT);
    expect(tableOf(host)).toBeNull();
    // An empty schedule is not a failure: no alert, no retry, no error text (AAP 0.7.4).
    expect(host.querySelectorAll('.alert')).toHaveLength(0);
    expect(textOf(host)).not.toContain(EMPTY_STATE_KEY);
  });

  it('renders the same empty state for a schedule that carries no periods', async () => {
    const fixture = await render(makeSchedule([]));
    const host = hostOf(fixture);
    const emptyState = emptyStateOf(host);

    expect(emptyState).not.toBeNull();
    expect(textOf(emptyState)).toBe(EMPTY_STATE_TEXT);
    expect(tableOf(host)).toBeNull();
    expect(host.querySelectorAll('.alert')).toHaveLength(0);
  });

  it('never renders the table and the empty state together', async () => {
    const host = hostOf(await render(makeSchedule([makePeriod()])));

    expect(tableOf(host)).not.toBeNull();
    expect(bodyRows(host)).toHaveLength(1);
    expect(emptyStateOf(host)).toBeNull();
  });
});
