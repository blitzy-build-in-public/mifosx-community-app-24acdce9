import { LOCALE_ID } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepaymentPeriod, RepaymentSchedule } from '../../loan.models';
import { LoanScheduleComponent } from './loan-schedule.component';

/**
 * Behavioural spec for the individual-loan record's repayment-schedule table (AAP 0.7.1
 * "`LoanViewComponent` with `LoanScheduleComponent`"; AAP 0.7.4). It pins the four things a reader of
 * that table depends on, each against the rendered DOM (Rule 1 clause 8):
 *
 * - one row per `RepaymentPeriod` of the `RepaymentSchedule`, in the server's order and under the
 *   eight columns the record page declares (AAP 0.10.2: the array order is meaningful);
 * - both wire date shapes render at the shared `dd MMMM yyyy` pattern, never as a raw triple, an ISO
 *   string or `Invalid Date` (AAP 0.7.2 "Date handling");
 * - every amount prints the payload's own figure — unsummed, unrounded, unrelabelled — which is what
 *   keeps the table in step with `GET /loans/{id}?associations=all` (Rule 1 clause 3);
 * - a `null` schedule and one with no periods both render the shared explicit empty state and no
 *   error, never a table (AAP 0.7.4 "States every list and record screen must implement").
 *
 * No request is asserted here: the component issues none — `loan.service.ts` reads the record and this
 * component only projects the schedule it is handed — so no HTTP provider is registered and the
 * injector below is the translate stack plus the locale and nothing else (Rule 1 clause 5, Rule 2).
 */

/** Language the spec serves its labels in. */
const SPEC_LANG = 'en';

/** Locale the two pipes format with, pinned so the assertions hold on any host. */
const SPEC_LOCALE = 'en-US';

/** The eight header keys `loan-schedule.component.html` translates, in render order. */
const COLUMN_KEYS: readonly string[] = [
  'label.heading.no',
  'label.heading.fromdate',
  'label.heading.date',
  'label.heading.principal',
  'label.heading.interest',
  'label.heading.fees',
  'label.heading.total',
  'label.heading.outstanding',
];

/** The label each header key resolves to in the in-memory bundle below. */
const COLUMN_LABELS: Readonly<Record<string, string>> = {
  'label.heading.no': 'No.',
  'label.heading.fromdate': 'From Date',
  'label.heading.date': 'Due Date',
  'label.heading.principal': 'Principal',
  'label.heading.interest': 'Interest',
  'label.heading.fees': 'Fees',
  'label.heading.total': 'Total',
  'label.heading.outstanding': 'Outstanding',
};

/** Legacy no-data label the template passes to the shared empty state. */
const EMPTY_STATE_KEY = 'label.nodata';

/** The message that key resolves to in the in-memory bundle. */
const EMPTY_STATE_TEXT = 'No repayment schedule is available.';

/**
 * The in-memory bundle: the nine keys the template uses and nothing else, so a key the legacy bundle
 * would not hold renders as itself and fails the assertion reading the label it feeds (AAP 0.10.2).
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  ...COLUMN_LABELS,
  [EMPTY_STATE_KEY]: EMPTY_STATE_TEXT,
};

/**
 * A complete `RepaymentPeriod`: every member the model declares is supplied, so a member it gains
 * later breaks this factory at compile time instead of passing silently (Rule 1 clause 4).
 */
function makePeriod(overrides: Partial<RepaymentPeriod> = {}): RepaymentPeriod {
  return {
    period: 1,
    fromDate: [2026, 11, 21],
    dueDate: [2026, 12, 21],
    principalDue: 416.67,
    principalOriginalDue: 416.67,
    interestDue: 50,
    feeChargesDue: 0,
    penaltyChargesDue: 0,
    totalDueForPeriod: 466.67,
    totalOriginalDueForPeriod: 466.67,
    principalOutstanding: 4583.33,
    interestOutstanding: 550,
    totalOutstandingForPeriod: 5133.33,
    complete: false,
    ...overrides,
  };
}

/** A complete `RepaymentSchedule`: the periods in server order plus the loan-wide totals. */
function makeSchedule(periods: readonly RepaymentPeriod[]): RepaymentSchedule {
  return {
    periods,
    totalPrincipalDisbursed: 5000,
    totalPrincipalExpected: 5000,
    totalInterestCharged: 600,
    totalFeeChargesCharged: 25,
    totalRepaymentExpected: 5625,
    totalOutstanding: 5625,
    loanTermInDays: 395,
  };
}

/** An element's text with runs of whitespace collapsed to one space and the ends trimmed. */
function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('LoanScheduleComponent', () => {
  /** The fixture's host element, the root every query below starts from. */
  function hostOf(fixture: ComponentFixture<LoanScheduleComponent>): HTMLElement {
    // `ComponentFixture.nativeElement` is loosely typed by Angular; narrowing it once here keeps every
    // element these helpers return an `HTMLElement` and confines the cast to one boundary (Rule 1 c. 4).
    return fixture.nativeElement as HTMLElement;
  }

  /** The schedule table, or `null` while the component renders the empty state. */
  function tableOf(host: HTMLElement): HTMLTableElement | null {
    return host.querySelector<HTMLTableElement>('table#loan-schedule');
  }

  /** The shared empty state, or `null` when the table is rendered instead. */
  function emptyStateOf(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>('app-empty-state#loan-schedule-empty');
  }

  /** The table's header cells in render order. */
  function headerCells(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('table#loan-schedule thead tr th'));
  }

  /** The table's body rows in render order. */
  function bodyRows(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('table#loan-schedule tbody tr'));
  }

  /** One body row's cells in render order. */
  function cellsOf(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>('td'));
  }

  /** Every body row's cell texts: `[row][column]`, in render order. */
  function renderedRows(host: HTMLElement): string[][] {
    return bodyRows(host).map((row) => cellsOf(row).map((cell) => textOf(cell)));
  }

  /**
   * Renders the table bound to `schedule`. The input is set before the first change detection, then
   * the fixture is stabilised and checked again: `TranslatePipe` is impure, so a header label is read
   * through the template on every pass and the assertions must follow the pass that resolves the
   * bundle rather than the one that renders the markup.
   */
  async function render(schedule: RepaymentSchedule | null): Promise<ComponentFixture<LoanScheduleComponent>> {
    const fixture = TestBed.createComponent(LoanScheduleComponent);

    fixture.componentRef.setInput('schedule', schedule);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  beforeEach(async () => {
    // `provideTranslateService()` registers the translate stack with no-op loading, so nothing is
    // fetched and the labels are the in-memory bundle served below (Rule 1 clause 5).
    await TestBed.configureTestingModule({
      imports: [LoanScheduleComponent],
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

  it('renders one row per RepaymentPeriod of the RepaymentSchedule, under the eight schedule columns', async () => {
    const host = hostOf(
      await render(makeSchedule([makePeriod({ period: 1 }), makePeriod({ period: 2 }), makePeriod({ period: 3 })])),
    );
    const rows = bodyRows(host);

    expect(tableOf(host)).not.toBeNull();
    expect(headerCells(host).map(textOf)).toEqual(COLUMN_KEYS.map((key) => COLUMN_LABELS[key]));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => cellsOf(row).length)).toEqual([8, 8, 8]);
    // Every label resolved: no raw dotted key reaches the user (AAP 0.10.2).
    expect(textOf(host)).not.toContain('label.');
    // A populated schedule shows the table only, never the empty state as well (AAP 0.7.4).
    expect(emptyStateOf(host)).toBeNull();
  });

  it('renders the only table carrying the schedule id and the two design-system classes', async () => {
    const host = hostOf(await render(makeSchedule([makePeriod()])));
    const table = tableOf(host);

    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(table?.id).toBe('loan-schedule');
    expect(table?.classList.contains('table')).toBe(true);
    expect(table?.classList.contains('table-striped')).toBe(true);
  });

  it('keeps the server order and prints a period cell by cell in column order', async () => {
    const host = hostOf(
      await render(
        makeSchedule([
          makePeriod({ period: 2, fromDate: [2026, 12, 21] }),
          makePeriod({
            period: 1,
            fromDate: [2026, 11, 21],
            dueDate: '2026-12-05',
            principalDue: 100,
            interestDue: 10,
            feeChargesDue: 0,
            totalDueForPeriod: 110,
            totalOutstandingForPeriod: 990,
          }),
        ]),
      ),
    );
    const rows = renderedRows(host);

    expect(rows.map((cells) => cells[0])).toEqual(['2', '1']);
    expect(rows[1]).toEqual(['1', '21 November 2026', '05 December 2026', '100', '10', '0', '110', '990']);
  });

  it('renders both Fineract date shapes at the shared dd MMMM yyyy pattern', async () => {
    // The two shapes `FineractDate` declares: the `[year, month, day]` triple and the `'yyyy-MM-dd'`
    // string. Neither may reach the DOM — the shared display pattern is what a reader sees
    // (AAP 0.7.2 "Date handling").
    const host = hostOf(
      await render(makeSchedule([makePeriod({ fromDate: [2026, 11, 21], dueDate: '1988-03-14' })])),
    );
    const [cells] = renderedRows(host);

    expect(cells[1]).toBe('21 November 2026');
    expect(cells[2]).toBe('14 March 1988');
    expect(textOf(host)).not.toContain('2026-11-21');
  });

  it('renders a wire date that names no calendar day as an empty cell, never an invalid date', async () => {
    const fixture = await render(makeSchedule([makePeriod({ fromDate: '2026-02-30', dueDate: [2026, 13, 1] })]));
    const [cells] = renderedRows(hostOf(fixture));

    expect(cells[1]).toBe('');
    expect(cells[2]).toBe('');
    expect(textOf(hostOf(fixture))).not.toContain('Invalid Date');
  });

  it('renders each amount as the payload figure it came from, summed and rounded by nobody', async () => {
    const host = hostOf(
      await render(
        makeSchedule([
          makePeriod({
            principalDue: 4000,
            interestDue: 10,
            feeChargesDue: 0,
            totalDueForPeriod: 456.78,
            totalOutstandingForPeriod: 1234.5,
          }),
        ]),
      ),
    );
    const [cells] = renderedRows(host);

    expect(cells[3]).toBe('4,000');
    expect(cells[4]).toBe('10');
    expect(cells[5]).toBe('0');
    expect(cells[6]).toBe('456.78');
    expect(cells[7]).toBe('1,234.5');
    // The total is the server's own figure, not principal plus interest, and the principal cell holds
    // its own member rather than that total (Rule 1 clause 3: match legacy, do not improve on it).
    expect(cells[6]).not.toBe('4,010');
    expect(cells[3]).not.toBe('456.78');
  });

  it('prints every period total due unchanged, row by row', async () => {
    const host = hostOf(
      await render(
        makeSchedule([
          makePeriod({ period: 1, totalDueForPeriod: 466.67 }),
          makePeriod({ period: 2, totalDueForPeriod: 470 }),
          makePeriod({ period: 3, totalDueForPeriod: 0 }),
        ]),
      ),
    );

    expect(renderedRows(host).map((cells) => cells[6])).toEqual(['466.67', '470', '0']);
  });

  it('renders the explicit empty state, and no table, for a schedule the record page has not loaded', async () => {
    const host = hostOf(await render(null));
    const emptyState = emptyStateOf(host);

    expect(emptyState).not.toBeNull();
    expect(textOf(emptyState)).toBe(EMPTY_STATE_TEXT);
    expect(tableOf(host)).toBeNull();
    // An absent schedule is not a failure: no alert and no raw key stands in for the message.
    expect(host.querySelectorAll('.alert')).toHaveLength(0);
    expect(textOf(host)).not.toContain(EMPTY_STATE_KEY);
  });

  it('renders the same empty state for a RepaymentSchedule that carries no periods', async () => {
    const host = hostOf(await render(makeSchedule([])));

    expect(emptyStateOf(host)).not.toBeNull();
    expect(textOf(host)).toBe(EMPTY_STATE_TEXT);
    expect(tableOf(host)).toBeNull();
    expect(bodyRows(host)).toHaveLength(0);
    expect(host.querySelectorAll('.alert')).toHaveLength(0);
  });
});
