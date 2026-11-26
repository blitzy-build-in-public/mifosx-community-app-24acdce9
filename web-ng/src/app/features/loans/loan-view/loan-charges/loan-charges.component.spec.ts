import { DatePipe } from '@angular/common';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_FUNCTIONS, PermissionsService } from '../../../../core/auth/permissions.service';
import { DISPLAY_DATE_FORMAT } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import { MoneyPipe } from '../../../../shared/money/money.pipe';
import type { LoanCharge, LoanCurrency, LoanStatus } from '../../loan.models';
import { LoanChargesComponent } from './loan-charges.component';

/** Behavioural spec for the charges section of the individual-loan record — `app-loan-charges`, the `LoanChargesComponent` row of AAP 0.7.1's loans feature, rendered inside the record's charge tab (`#/viewloanaccount/:id`; AAP 0.7.4, AAP 0.7.2, AAP 0.7.3, AAP 0.11.1). */

/** The loan every case is bound to, in the form the record binds it — `record.id`, a number. */
const LOAN_ID = 7;

/** The two forms the `loanId` input accepts: the numeric id the record passes and the string form a `:id` route parameter delivers. */
const LOAN_ID_FORMS: readonly (number | string)[] = [LOAN_ID, String(LOAN_ID)];

/** The one permission code this section is gated on: `UPDATE_LOAN`, the code the record passes down and the code `loans.routes.ts` guards `loanaccountcharge/:id/:action/:chargeId` with, so the directive and the guard (AAP 0.14.1). */
const ACTION_PERMISSION = 'UPDATE_LOAN';

/** The captions this section resolves, keyed exactly as the shipped flat legacy bundles key them (`app/global-translations/`). */
const TRANSLATIONS = {
  'label.heading.charges': 'Charges',
  'label.heading.name': 'Name',
  'label.heading.dueasof': 'Due as of',
  'label.heading.amount': 'Amount',
  'label.heading.paid': 'Paid',
  'label.heading.waived': 'Waived',
  'label.heading.outstanding': 'Outstanding',
  'label.heading.actions': 'Actions',
  'label.button.paycharge': 'Pay Charge',
  'label.button.waivecharge': 'Waive Charge',
  'label.nodata': 'No Data',
};

/** The keys of the seven column headings, in the template's order. */
const HEADING_KEYS = [
  'label.heading.name',
  'label.heading.dueasof',
  'label.heading.amount',
  'label.heading.paid',
  'label.heading.waived',
  'label.heading.outstanding',
  'label.heading.actions',
] as const satisfies readonly (keyof typeof TRANSLATIONS)[];

/** The seven headings as the table must render them: the bundle's wording, never the key. */
const HEADINGS: readonly string[] = HEADING_KEYS.map((key) => TRANSLATIONS[key]);

/** The currency every fixture charge is denominated in, as `GET /loans/{id}?associations=all` reports it inside each `charges[]` entry: the table prints this symbol in front of each of the charge's figures, with no space between them (Rule 1 clause 3). */
const CURRENCY: LoanCurrency = {
  code: 'USD',
  name: 'US Dollar',
  displaySymbol: '$',
  decimalPlaces: 2,
};

/** The date format the table uses, through the one pattern the application declares (AAP 0.7.2). */
const DUE_DATE_PIPE = new DatePipe('en-US');

/** Formats `date` exactly as the table's due-date cell does. */
function asDueDate(date: Date): string | null {
  return DUE_DATE_PIPE.transform(date, DISPLAY_DATE_FORMAT);
}

/** The local-midnight `Date` a `[2026, 3, 14]` payload date parses to, written the same way. */
const DUE_DATE = new Date(2026, 2, 14);

/** Status values a charge's type members carry; the table renders neither, it only passes them by. */
const SPECIFIED_DUE_DATE = { id: 2, value: 'Specified due date' };
const DISBURSEMENT = { id: 1, value: 'Disbursement' };
const FLAT = { id: 1, value: 'Flat' };

/** The loan state both charge actions require: Fineract's `LoanStatus.ACTIVE`, as `GET /loans/{id}` reports it. */
const ACTIVE_STATUS: LoanStatus = {
  id: 300,
  code: 'loanStatusType.active',
  value: 'Active',
};

/** A charge that falls due on a given date, is still wholly outstanding and is payable through an account transfer: the row whose every cell carries a value and which legacy offers both actions on. */
const CHARGE_DUE: LoanCharge = {
  id: 11,
  chargeId: 5,
  name: 'Parity Fee',
  currency: CURRENCY,
  amount: 25,
  amountOrPercentage: 25,
  amountPaid: 0,
  amountWaived: 0,
  amountOutstanding: 25,
  paid: false,
  waived: false,
  chargePayable: true,
  chargeTimeType: SPECIFIED_DUE_DATE,
  chargeCalculationType: FLAT,
  dueDate: [2026, 3, 14],
};

/** The same charge settled: paid in full, which is why it is neither payable nor waivable. */
const CHARGE_SETTLED: LoanCharge = {
  id: 12,
  chargeId: 6,
  name: 'Service Fee',
  currency: CURRENCY,
  amount: 1250.5,
  amountOrPercentage: 1250.5,
  amountPaid: 1250.5,
  amountWaived: 0,
  amountOutstanding: 0,
  paid: true,
  waived: false,
  chargePayable: false,
  chargeTimeType: SPECIFIED_DUE_DATE,
  chargeCalculationType: FLAT,
};

/** The same outstanding charge with a regular payment mode: Fineract's `isChargePayable()` answers false for it, because paying it means paying through an account transfer, so the record offers waive and withholds pay. */
const CHARGE_NOT_PAYABLE: LoanCharge = { ...CHARGE_DUE, id: 13, chargePayable: false };

/** The same charge waived: its charge is settled, so the record withholds both actions. */
const CHARGE_WAIVED: LoanCharge = {
  ...CHARGE_DUE,
  id: 14,
  amountWaived: 25,
  amountOutstanding: 0,
  waived: true,
  chargePayable: false,
};

/** The same charge taken at disbursement: legacy sets its `actionFlag` on `chargeTimeType.value == 'Disbursement'`, so the record never offers to waive it, while a payable charge still offers pay. */
const CHARGE_AT_DISBURSEMENT: LoanCharge = {
  ...CHARGE_DUE,
  id: 15,
  chargeTimeType: DISBURSEMENT,
};

/** The two rows every table case renders, in the order the payload lists them. */
const CHARGES: readonly LoanCharge[] = [CHARGE_DUE, CHARGE_SETTLED];

/** The loan states in which the record offers neither charge action, by the fork's own `LoanStatus` ids — every state but `300` — plus the state a payload that reports no status leaves. */
const NOT_ACTIVE_STATUSES: readonly (readonly [string, LoanStatus | null])[] = [
  [
    'submitted and pending approval',
    { id: 100, code: 'loanStatusType.submitted.and.pending.approval', value: 'Submitted and pending approval' },
  ],
  ['approved', { id: 200, code: 'loanStatusType.approved', value: 'Approved' }],
  [
    'withdrawn by client',
    { id: 400, code: 'loanStatusType.withdrawn.by.client', value: 'Withdrawn by client' },
  ],
  [
    'closed with obligations met',
    { id: 600, code: 'loanStatusType.closed.obligations.met', value: 'Closed (obligations met)' },
  ],
  ['reported no status at all', null],
];

/** The half of `PermissionsService` the `hasPermission` directive asks, carrying the legacy algebra for `ALL_FUNCTIONS` and a leading `!` so the gate is answered the way the shipped service answers it. */
class PermissionsStub implements Pick<PermissionsService, 'has'> {
  private readonly granted: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /** Whether the permission — or its absence, for a negated code — is held. */
  has(key: string): boolean {
    const code = key.trim();

    if (code.startsWith('!')) {
      const negated = code.slice(1).trim();

      return negated.length > 0 && !this.granted().includes(negated);
    }

    return this.granted().includes(ALL_FUNCTIONS) || this.granted().includes(code);
  }

  /** Replaces the granted list, as a login or a withdrawal does. */
  grant(codes: readonly string[]): void {
    this.granted.set(codes);
  }
}

describe('LoanChargesComponent', () => {
  let fixture: ComponentFixture<LoanChargesComponent>;
  let permissions: PermissionsStub;
  let money: MoneyPipe;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines this spec's only cast to one line and keeps every DOM assertion type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** Formats `value` exactly as the table's amount cells do: through the one shared money pipe, with the charge's own currency, so an expectation built here can never be met by a second formatting rule the table might drift to (AAP 0.10.2, Rule 1 clause 3). */
  function asAmount(value: number): string | null {
    return money.transform(value, CURRENCY);
  }

  /** Mounts the section for one loan with the charges the record hands it, on the loan status the record reports — `Active` unless a case is about the state that withholds both actions. */
  function mount(
    charges: readonly LoanCharge[],
    loanId: number | string = LOAN_ID,
    loanStatus: LoanStatus | null = ACTIVE_STATUS,
  ): ComponentFixture<LoanChargesComponent> {
    fixture = TestBed.createComponent(LoanChargesComponent);
    fixture.componentRef.setInput('charges', charges);
    fixture.componentRef.setInput('loanId', loanId);
    fixture.componentRef.setInput('loanStatus', loanStatus);
    fixture.componentRef.setInput('actionPermission', ACTION_PERMISSION);
    fixture.detectChanges();

    return fixture;
  }

  /** The rendered charge rows, in document order. */
  function renderedRows(): HTMLTableRowElement[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('#loan-charges tbody tr'));
  }

  /** Every cell of `row` as trimmed text, in column order. */
  function cellsOf(row: HTMLTableRowElement): readonly string[] {
    return Array.from(row.cells).map((cell) => (cell.textContent ?? '').trim());
  }

  /** The element carrying `id`, or `null` when the template rendered none. */
  function byId(id: string): HTMLElement | null {
    return host().querySelector<HTMLElement>(`#${id}`);
  }

  /** The route a charge action names: `#/loanaccountcharge/:id/:action/:chargeId`, the path `loans.routes.ts` declares and `loan-charge-form.component.ts` serves (AAP 0.8.2). */
  function chargeUrl(
    loanId: number | string,
    action: 'pay' | 'waive',
    chargeId: number,
  ): string {
    return `/loanaccountcharge/${loanId}/${action}/${chargeId}`;
  }

  /** Whether the row's action link is hidden by the section's own eligibility rule — Bootstrap's global `.hidden` utility — rather than removed. */
  function hiddenByRule(action: 'pay' | 'waive', chargeId: number): boolean {
    const anchor = byId(`loan-charge-${action}-${chargeId}`);

    expect(anchor).not.toBeNull();

    return anchor?.classList.contains('hidden') ?? false;
  }

  beforeEach(async () => {
    // Reset first so each case starts on a fresh root injector: a permission granted by one case must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    permissions = new PermissionsStub();
    permissions.grant([ACTION_PERMISSION]);

    await TestBed.configureTestingModule({
      imports: [LoanChargesComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PermissionsService, useValue: permissions },
        provideTranslateService({ lang: 'en', fallbackLang: 'en' }),
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    // The pipe the cells render through, built inside the TestBed's injection context the way the framework builds it, so its locale is the host's default of `en-US` — the locale the expectations below are written in (Rule 1 clause 8).
    money = TestBed.runInInjectionContext(() => new MoneyPipe());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per charge, in the payload’s order, in the seven legacy columns', () => {
    mount(CHARGES);

    expect(byId('loan-charges')).not.toBeNull();

    const headings = Array.from(
      host().querySelectorAll<HTMLTableCellElement>('#loan-charges thead th'),
    ).map((cell) => (cell.textContent ?? '').trim());

    // The template's seven columns and no eighth: a charge carries no status and no total column, so none is asserted here (Rule 1 clause 3).
    expect(headings).toEqual(HEADINGS);
    expect(host().textContent ?? '').not.toContain('label.heading.');

    const rows = renderedRows();

    expect(rows).toHaveLength(2);

    expect(cellsOf(rows[0]).slice(0, 6)).toEqual([
      CHARGE_DUE.name,
      asDueDate(DUE_DATE) ?? '',
      asAmount(CHARGE_DUE.amount) ?? '',
      asAmount(CHARGE_DUE.amountPaid) ?? '',
      asAmount(CHARGE_DUE.amountWaived) ?? '',
      asAmount(CHARGE_DUE.amountOutstanding) ?? '',
    ]);
    expect(cellsOf(rows[1]).slice(0, 6)).toEqual([
      CHARGE_SETTLED.name,
      '',
      asAmount(CHARGE_SETTLED.amount) ?? '',
      asAmount(CHARGE_SETTLED.amountPaid) ?? '',
      asAmount(CHARGE_SETTLED.amountWaived) ?? '',
      asAmount(CHARGE_SETTLED.amountOutstanding) ?? '',
    ]);
    expect(cellsOf(rows[1])[2]).toBe('$1,250.5');
    // The charge's own currency symbol stands immediately before each figure, with no space between them, which is what the legacy charge table prints (`app/views/loans/viewloanaccountdetails.html:854-857`).
    expect(cellsOf(rows[0]).slice(2, 6)).toEqual(['$25', '$0', '$0', '$25']);
    expect(cellsOf(rows[0])[1]).toBe('14 March 2026');
    expect(cellsOf(rows[0])[0]).toBe(CHARGE_DUE.name);
  });

  it('names the table with the charges heading through a visually hidden caption', () => {
    mount(CHARGES);

    const table = byId('loan-charges');
    const caption = table?.querySelector('caption');

    // The caption is the table's own naming element and Bootstrap's `.sr-only` keeps it off the screen, so the table is announced by the legacy bundle's charges heading without a pixel moving.
    expect(caption?.textContent?.trim()).toBe(TRANSLATIONS['label.heading.charges']);
    expect(caption?.classList.contains('sr-only')).toBe(true);
    expect(table?.firstElementChild).toBe(caption);
  });

  /** The waived-write-off case: a charge written off at 25 carries that figure in its own column, so its 0 Paid and 0 Outstanding cannot read as a paid charge whose amount went nowhere. The column is legacy's own `label.heading.waived` treatment and no state word, badge, class or aria-label is added beside it (Rule 1 clause 3). */
  it('renders a waived charge’s written-off amount in the Waived column beside a paid charge’s', () => {
    mount([CHARGE_WAIVED, CHARGE_SETTLED]);

    const [waived, paid] = renderedRows().map(cellsOf);

    expect(waived.slice(0, 6)).toEqual([
      CHARGE_WAIVED.name,
      asDueDate(DUE_DATE) ?? '',
      asAmount(CHARGE_WAIVED.amount) ?? '',
      asAmount(CHARGE_WAIVED.amountPaid) ?? '',
      asAmount(CHARGE_WAIVED.amountWaived) ?? '',
      asAmount(CHARGE_WAIVED.amountOutstanding) ?? '',
    ]);
    expect(paid.slice(0, 6)).toEqual([
      CHARGE_SETTLED.name,
      '',
      asAmount(CHARGE_SETTLED.amount) ?? '',
      asAmount(CHARGE_SETTLED.amountPaid) ?? '',
      asAmount(CHARGE_SETTLED.amountWaived) ?? '',
      asAmount(CHARGE_SETTLED.amountOutstanding) ?? '',
    ]);
    expect([waived[3], waived[4], waived[5]]).toEqual(['$0', '$25', '$0']);
    expect([paid[3], paid[4], paid[5]]).toEqual(['$1,250.5', '$0', '$0']);
    // Nothing was invented to say so: no status word, badge or tooltip joins the three amounts (Rule 1 clause 3).
    expect(host().querySelector('#loan-charges tbody .badge, #loan-charges tbody [title]')).toBeNull();
  });

  it('renders the explicit empty state and no error for a loan carrying no charges', () => {
    mount([]);

    // The shared explicit empty state is the whole body, and the sentence it carries is the legacy bundle's own "No Data" (AAP 0.7.4).
    expect(fixture.debugElement.queryAll(By.directive(EmptyStateComponent))).toHaveLength(1);
    expect(byId('loan-charges-empty')?.textContent?.trim()).toBe(TRANSLATIONS['label.nodata']);
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('.alert')).toBeNull();
    expect(host().querySelector('.alert-danger')).toBeNull();
    expect((host().textContent ?? '').toLowerCase()).not.toContain('error');
    // The first charge is added from the record's own action group — the single entry point to `#/addloancharge/:id` (see `loan-view.component.html`) — so an empty section offers no second control for that one route (Rule 1 clause 3).
    expect(host().querySelector('a[href^="/addloancharge"]')).toBeNull();
  });

  it('links each charge’s pay and waive actions to the charge route for the bound loan', () => {
    for (const loanId of LOAN_ID_FORMS) {
      mount([CHARGE_DUE], loanId);

      const pay = byId(`loan-charge-pay-${CHARGE_DUE.id}`);
      const waive = byId(`loan-charge-waive-${CHARGE_DUE.id}`);

      expect(pay).not.toBeNull();
      expect(waive).not.toBeNull();
      expect(pay?.classList.contains('hidden')).toBe(false);
      expect(waive?.classList.contains('hidden')).toBe(false);
      expect(pay?.getAttribute('href')).toBe(chargeUrl(loanId, 'pay', CHARGE_DUE.id));
      expect(waive?.getAttribute('href')).toBe(chargeUrl(loanId, 'waive', CHARGE_DUE.id));
      expect(pay?.textContent?.trim()).toBe(TRANSLATIONS['label.button.paycharge']);
      expect(waive?.textContent?.trim()).toBe(TRANSLATIONS['label.button.waivecharge']);
    }
  });

  it.each<[string, LoanCharge, { readonly pay: boolean; readonly waive: boolean }]>([
    ['a payable charge that is unsettled', CHARGE_DUE, { pay: true, waive: true }],
    [
      'a charge that is not payable through an account transfer',
      CHARGE_NOT_PAYABLE,
      { pay: false, waive: true },
    ],
    ['a charge that has been paid', CHARGE_SETTLED, { pay: false, waive: false }],
    ['a charge that has been waived', CHARGE_WAIVED, { pay: false, waive: false }],
    [
      'a charge that falls due on disbursement',
      CHARGE_AT_DISBURSEMENT,
      { pay: true, waive: false },
    ],
  ])(
    'offers exactly the actions legacy offers on an active loan for %s',
    (_label, charge, offered) => {
      mount([charge], LOAN_ID, ACTIVE_STATUS);

      // Legacy's rule, condition by condition: waive is hidden once the charge is paid or waived, once it falls due on disbursement, and whenever the loan is not active; pay is shown only for a `chargePayable` charge on an active loan (`ViewLoanDetailsController.js:168-175`; `viewloanaccountdetails.html:865,868`).
      expect(hiddenByRule('pay', charge.id)).toBe(!offered.pay);
      expect(hiddenByRule('waive', charge.id)).toBe(!offered.waive);
    },
  );

  it.each(NOT_ACTIVE_STATUSES)(
    'hides both actions for a charge on a loan that is %s',
    (_label, loanStatus) => {
      mount([CHARGE_DUE], LOAN_ID, loanStatus);

      // `charge.chargePayable && status=='Active'` and `actionFlag`'s own `loan.status.value != 'Active'`: on any state but Active the record offers neither action, whatever the charge's own flags say.
      expect(hiddenByRule('pay', CHARGE_DUE.id)).toBe(true);
      expect(hiddenByRule('waive', CHARGE_DUE.id)).toBe(true);
    },
  );

  it('hides the two action links without removing them when the charge permission is not held', () => {
    permissions.grant([]);
    mount(CHARGES);

    for (const charge of CHARGES) {
      const pay = byId(`loan-charge-pay-${charge.id}`);
      const waive = byId(`loan-charge-waive-${charge.id}`);

      // Hide, never remove: legacy toggled the element's visibility and Bootstrap 3 lays the row out around its declared box, so the anchors keep their place in the document.
      expect(pay).not.toBeNull();
      expect(waive).not.toBeNull();
      expect(pay?.style.display).toBe('none');
      expect(waive?.style.display).toBe('none');
    }

    // The gate follows the permission list: granting the code reveals the same elements, without a re-render of the section's structure, which is what makes the directive and the route guard agree at template level (AAP 0.1.1, AAP 0.14.1).
    permissions.grant([ACTION_PERMISSION]);
    fixture.detectChanges();

    const revealed = byId(`loan-charge-pay-${CHARGE_DUE.id}`);

    expect(revealed).not.toBeNull();
    expect(revealed?.style.display).not.toBe('none');
    expect(byId(`loan-charge-waive-${CHARGE_DUE.id}`)?.style.display).not.toBe('none');

    const settledWaive = byId(`loan-charge-waive-${CHARGE_SETTLED.id}`);

    expect(settledWaive?.style.display).toBe('');
    expect(settledWaive?.classList.contains('hidden')).toBe(true);

    permissions.grant([]);
    fixture.detectChanges();

    expect(byId(`loan-charge-pay-${CHARGE_DUE.id}`)?.style.display).toBe('none');
    expect(byId(`loan-charge-waive-${CHARGE_DUE.id}`)).not.toBeNull();
  });

  it('leaves the due-date cell empty for a charge that carries no due date', () => {
    mount([CHARGE_SETTLED]);

    const cells = cellsOf(renderedRows()[0]);

    // The payload sent no date, so the cell carries nothing at all: no dash, no `N/A`, no `null` and no `Invalid Date` the parser might have handed the pipe (Rule 1 clause 3).
    expect(cells[1]).toBe('');
    expect(cells[1] ?? '').not.toMatch(/^(?:[-–—]+|n\/?a|null|undefined|invalid date)$/i);
  });
});
