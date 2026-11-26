import { DatePipe, DecimalPipe } from '@angular/common';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_FUNCTIONS, PermissionsService } from '../../../../core/auth/permissions.service';
import { DISPLAY_DATE_FORMAT } from '../../../../shared/date-format.util';
import { EmptyStateComponent } from '../../../../shared/empty-state/empty-state.component';
import type { LoanCharge } from '../../loan.models';
import { LoanChargesComponent } from './loan-charges.component';

/**
 * Behavioural spec for the charges section of the individual-loan record — `app-loan-charges`, the
 * `LoanChargesComponent` row of AAP 0.7.1's loans feature, rendered inside the record's charge tab
 * (`#/viewloanaccount/:id`; AAP 0.7.4) and driven by the loan record's own `charges` member
 * (AAP 0.7.2 row `LoanCharge`; AAP 0.7.3 row "Loan charges"; AAP 0.11.1 "unit specs beside every
 * component and service"; Rule 1 clause 8, "tests prove behaviour").
 *
 * What it pins, case by case, is everything the section decides for itself:
 *
 *  1. one row per charge, in the payload's order, in the six columns the template declares — name,
 *     due date, amount, paid, outstanding and actions — each figure the server's own value rendered
 *     through `DecimalPipe` and the due date through the shared `DISPLAY_DATE_FORMAT`, so a charge's
 *     name is never translated and no column is invented (Rule 1 clause 3);
 *  2. a loan carrying no charges renders the shared explicit empty state and no error: no table, no
 *     alert region and no failure wording anywhere (AAP 0.7.4, "an explicit empty state and no
 *     error");
 *  3. each charge's `pay` and `waive` entry points are links to the charge form's route,
 *     `#/loanaccountcharge/:id/:action/:chargeId`, built from the `loanId` the record binds and the
 *     row's own id, so one row's action can never name another loan or another charge. Both links are
 *     rendered for every row, including a charge with nothing outstanding: the section leaves a step's
 *     legality to the server, exactly as the record's action group treats its own commands, so no case
 *     here withholds a link for a settled charge (Rule 1 clause 3 — match legacy, do not improve it);
 *  4. those two links are gated by `HasPermissionDirective` on the single code the record passes
 *     down, and the gate **hides without removing**: the anchors stay in the document, `display`
 *     alone changes, and it follows the permission list in both directions (AAP 0.1.1, "a route
 *     guard and a template directive must agree"; AAP 0.14.1);
 *  5. a charge that carries no due date leaves its cell empty — no dash, no `N/A`, no `null`, no
 *     `Invalid Date` — because the payload sent no date and nothing here invents one (Rule 1
 *     clause 3).
 *
 * **Providers.** The real router, with an empty route table, because the section's actions are
 * `RouterLink`s and the rendered `href` is the evidence. The real `TranslatePipe` over a real
 * `TranslateService` pre-filled with the captions the shipped legacy bundle carries
 * (`app/global-translations/locale-en.json`), so a label that failed to resolve would surface as the
 * key rather than as the wording asserted below. `HasPermissionDirective` and `PermissionsService`
 * are the shipped classes; only the service's answer is substituted, through a typed stub provided at
 * its own token, because the real one reads the session a unit test has no business assembling — the
 * same substitution `loan-view.component.spec.ts` and `navbar.component.spec.ts` make for the same
 * directive.
 *
 * **No transport is installed** — no `provideHttpClient` and no `provideHttpClientTesting` — because
 * this section injects nothing and issues no request: it renders what its parent hands it, which is
 * how the record keeps making exactly the calls its typed service owns (Rule 1 clause 5). A spec that
 * needed `HttpTestingController` would mean the component had grown a dependency it must not have.
 *
 * The fixtures are synthetic: invented charge names and figures. Nothing here carries tenant data, a
 * credential or an authentication key, and nothing is logged (Rule 1 clause 9).
 */

/** The loan every case is bound to, in the form the record binds it — `record.id`, a number. */
const LOAN_ID = 7;

/**
 * The two forms the `loanId` input accepts: the numeric id the record passes and the string form a
 * `:id` route parameter delivers. Both segment into the same link, which case 3 asserts.
 */
const LOAN_ID_FORMS: readonly (number | string)[] = [LOAN_ID, String(LOAN_ID)];

/**
 * The one permission code this section is gated on: `UPDATE_LOAN`, the code the record passes down
 * and the code `loans.routes.ts` guards `loanaccountcharge/:id/:action/:chargeId` with, so the
 * directive and the guard cannot disagree (AAP 0.14.1).
 */
const ACTION_PERMISSION = 'UPDATE_LOAN';

/**
 * The captions this section resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`). Serving the bundle's wording rather than the key is what proves each
 * caption resolves through the pipe instead of falling back to the raw dotted string.
 */
const TRANSLATIONS = {
  'label.heading.name': 'Name',
  'label.heading.dueasof': 'Due as of',
  'label.heading.amount': 'Amount',
  'label.heading.paid': 'Paid',
  'label.heading.outstanding': 'Outstanding',
  'label.heading.actions': 'Actions',
  'label.button.paycharge': 'Pay Charge',
  'label.button.waivecharge': 'Waive Charge',
  'label.nodata': 'No Data',
};

/** The keys of the six column headings, in the template's order. */
const HEADING_KEYS = [
  'label.heading.name',
  'label.heading.dueasof',
  'label.heading.amount',
  'label.heading.paid',
  'label.heading.outstanding',
  'label.heading.actions',
] as const satisfies readonly (keyof typeof TRANSLATIONS)[];

/** The six headings as the table must render them: the bundle's wording, never the key. */
const HEADINGS: readonly string[] = HEADING_KEYS.map((key) => TRANSLATIONS[key]);

/**
 * The amount format the table uses — `DecimalPipe` at its default `1.0-3` digits, the same grouping
 * the legacy table's `number` filter applies. Every expected figure below is built through it rather
 * than written out, so a change in the pipe's output cannot pass silently (AAP 0.10.2 "displayed
 * data … and their formatting"; Rule 1 clause 3).
 */
const AMOUNT_PIPE = new DecimalPipe('en-US');

/** The date format the table uses, through the one pattern the application declares (AAP 0.7.2). */
const DUE_DATE_PIPE = new DatePipe('en-US');

/** Formats `value` exactly as the table's amount cells do. */
function asAmount(value: number): string | null {
  return AMOUNT_PIPE.transform(value);
}

/** Formats `date` exactly as the table's due-date cell does. */
function asDueDate(date: Date): string | null {
  return DUE_DATE_PIPE.transform(date, DISPLAY_DATE_FORMAT);
}

/** The local-midnight `Date` a `[2026, 3, 14]` payload date parses to, written the same way. */
const DUE_DATE = new Date(2026, 2, 14);

/** Status values a charge's type members carry; the table renders neither, it only passes them by. */
const SPECIFIED_DUE_DATE = { id: 2, value: 'Specified due date' };
const FLAT = { id: 1, value: 'Flat' };

/**
 * A charge that falls due on a given date and is still wholly outstanding: the row whose every cell
 * carries a value.
 */
const CHARGE_DUE: LoanCharge = {
  id: 11,
  chargeId: 5,
  name: 'Parity Fee',
  amount: 25,
  amountOrPercentage: 25,
  amountPaid: 0,
  amountWaived: 0,
  amountOutstanding: 25,
  chargeTimeType: SPECIFIED_DUE_DATE,
  chargeCalculationType: FLAT,
  dueDate: [2026, 3, 14],
};

/**
 * A charge that carries no due date and nothing outstanding, with a figure large enough to prove the
 * thousands grouping. Its absent `dueDate` is the state case 5 asserts an empty cell for. Its zero
 * outstanding deliberately withholds no action: both links render for every row and only the
 * permission gate decides their visibility.
 */
const CHARGE_SETTLED: LoanCharge = {
  id: 12,
  chargeId: 6,
  name: 'Service Fee',
  amount: 1250.5,
  amountOrPercentage: 1250.5,
  amountPaid: 1250.5,
  amountWaived: 0,
  amountOutstanding: 0,
  chargeTimeType: SPECIFIED_DUE_DATE,
  chargeCalculationType: FLAT,
};

/** The two rows every table case renders, in the order the payload lists them. */
const CHARGES: readonly LoanCharge[] = [CHARGE_DUE, CHARGE_SETTLED];

/**
 * The half of `PermissionsService` the `hasPermission` directive asks, carrying the legacy algebra
 * for `ALL_FUNCTIONS` and a leading `!` so the gate is answered the way the shipped service answers
 * it. The real service reads the session, which a unit test has no business assembling — the same
 * substitution `loan-view.component.spec.ts` makes for the same directive.
 */
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

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines this
  // spec's only cast to one line and keeps every DOM assertion type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Mounts the section for one loan with the charges the record hands it.
   *
   * Both inputs are bound before the first change detection: `loanId` and `actionPermission` are
   * required inputs, so the first pass would throw without them, and the gate's answer is read during
   * that same pass.
   */
  function mount(
    charges: readonly LoanCharge[],
    loanId: number | string = LOAN_ID,
  ): ComponentFixture<LoanChargesComponent> {
    fixture = TestBed.createComponent(LoanChargesComponent);
    fixture.componentRef.setInput('charges', charges);
    fixture.componentRef.setInput('loanId', loanId);
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

  /**
   * The route a charge action names: `#/loanaccountcharge/:id/:action/:chargeId`, the path
   * `loans.routes.ts` declares and `loan-charge-form.component.ts` serves (AAP 0.8.2).
   */
  function chargeUrl(
    loanId: number | string,
    action: 'pay' | 'waive',
    chargeId: number,
  ): string {
    return `/loanaccountcharge/${loanId}/${action}/${chargeId}`;
  }

  beforeEach(async () => {
    // Reset first so each case starts on a fresh root injector: a permission granted by one case must
    // never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    permissions = new PermissionsStub();
    // Ground state: a user who may pay and waive, so the table cases see the actions the section
    // renders. The gate's own case withholds and re-grants the code explicitly.
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
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders one row per charge, in the payload’s order, in the six legacy columns', () => {
    mount(CHARGES);

    expect(byId('loan-charges')).not.toBeNull();

    const headings = Array.from(
      host().querySelectorAll<HTMLTableCellElement>('#loan-charges thead th'),
    ).map((cell) => (cell.textContent ?? '').trim());

    // The template's six columns and no seventh: a charge carries no status, no currency symbol and
    // no total column, so none is asserted here (Rule 1 clause 3).
    expect(headings).toEqual(HEADINGS);
    // Every heading resolved through the pipe: the raw dotted keys never reach the screen.
    expect(host().textContent ?? '').not.toContain('label.heading.');

    const rows = renderedRows();

    expect(rows).toHaveLength(2);

    // The payload's order is kept — the due charge first, the settled one second — and each cell is
    // the server's own value.
    expect(cellsOf(rows[0]).slice(0, 5)).toEqual([
      CHARGE_DUE.name,
      asDueDate(DUE_DATE) ?? '',
      asAmount(CHARGE_DUE.amount) ?? '',
      asAmount(CHARGE_DUE.amountPaid) ?? '',
      asAmount(CHARGE_DUE.amountOutstanding) ?? '',
    ]);
    expect(cellsOf(rows[1]).slice(0, 5)).toEqual([
      CHARGE_SETTLED.name,
      '',
      asAmount(CHARGE_SETTLED.amount) ?? '',
      asAmount(CHARGE_SETTLED.amountPaid) ?? '',
      asAmount(CHARGE_SETTLED.amountOutstanding) ?? '',
    ]);
    // The figures the table prints are the pipe's own output for the payload's numbers, thousands
    // grouping included, rather than figures the component derived.
    expect(cellsOf(rows[1])[2]).toBe('1,250.5');
    expect(cellsOf(rows[0])[1]).toBe('14 March 2026');
    // The due charge's own name is shown verbatim: a charge's name is the server's, never translated.
    expect(cellsOf(rows[0])[0]).toBe(CHARGE_DUE.name);
  });

  it('renders the explicit empty state and no error for a loan carrying no charges', () => {
    mount([]);

    // The shared explicit empty state is the whole body, and the sentence it carries is the legacy
    // bundle's own "No Data" (AAP 0.7.4).
    expect(fixture.debugElement.queryAll(By.directive(EmptyStateComponent))).toHaveLength(1);
    expect(byId('loan-charges-empty')?.textContent?.trim()).toBe(TRANSLATIONS['label.nodata']);
    // Nothing claims rows the payload never carried: no table at all.
    expect(host().querySelector('table')).toBeNull();
    // An empty charge list is a state, not a failure: no alert region and no failure wording on screen.
    expect(host().querySelector('.alert')).toBeNull();
    expect(host().querySelector('.alert-danger')).toBeNull();
    expect((host().textContent ?? '').toLowerCase()).not.toContain('error');
    // The first charge is added from the record's own action group — the single entry point to
    // `#/addloancharge/:id` (see `loan-view.component.html`) — so an empty section offers no second
    // control for that one route (Rule 1 clause 3: one action, one home).
    expect(host().querySelector('a[href^="/addloancharge"]')).toBeNull();
  });

  it('links each charge’s pay and waive actions to the charge route for the bound loan', () => {
    for (const loanId of LOAN_ID_FORMS) {
      mount([CHARGE_DUE], loanId);

      const pay = byId(`loan-charge-pay-${CHARGE_DUE.id}`);
      const waive = byId(`loan-charge-waive-${CHARGE_DUE.id}`);

      expect(pay).not.toBeNull();
      expect(waive).not.toBeNull();
      // The anchor names the loan it belongs to and the charge the row carries, so one row's action
      // can never point at another loan or another charge. `app.config.ts` adds
      // `withHashLocation()`, so in the application these render as `#/loanaccountcharge/7/pay/11`;
      // this suite's router uses the default path strategy, which is why the bare path is asserted.
      expect(pay?.getAttribute('href')).toBe(chargeUrl(loanId, 'pay', CHARGE_DUE.id));
      expect(waive?.getAttribute('href')).toBe(chargeUrl(loanId, 'waive', CHARGE_DUE.id));
      expect(pay?.textContent?.trim()).toBe(TRANSLATIONS['label.button.paycharge']);
      expect(waive?.textContent?.trim()).toBe(TRANSLATIONS['label.button.waivecharge']);
    }
  });

  it('hides the two action links without removing them when the charge permission is not held', () => {
    permissions.grant([]);
    mount(CHARGES);

    for (const charge of CHARGES) {
      const pay = byId(`loan-charge-pay-${charge.id}`);
      const waive = byId(`loan-charge-waive-${charge.id}`);

      // Hide, never remove: legacy toggled the element's visibility and Bootstrap 3 lays the row out
      // around its declared box, so the anchors keep their place in the document.
      expect(pay).not.toBeNull();
      expect(waive).not.toBeNull();
      expect(pay?.style.display).toBe('none');
      expect(waive?.style.display).toBe('none');
    }

    // The gate follows the permission list: granting the code reveals the same elements, without a
    // re-render of the section's structure, which is what makes the directive and the route guard
    // agree at template level (AAP 0.1.1; AAP 0.14.1).
    permissions.grant([ACTION_PERMISSION]);
    fixture.detectChanges();

    const revealed = byId(`loan-charge-pay-${CHARGE_DUE.id}`);

    expect(revealed).not.toBeNull();
    expect(revealed?.style.display).not.toBe('none');
    expect(byId(`loan-charge-waive-${CHARGE_DUE.id}`)?.style.display).not.toBe('none');

    // Withdrawing it hides them again, still in place.
    permissions.grant([]);
    fixture.detectChanges();

    expect(byId(`loan-charge-pay-${CHARGE_DUE.id}`)?.style.display).toBe('none');
    expect(byId(`loan-charge-waive-${CHARGE_DUE.id}`)).not.toBeNull();
  });

  it('leaves the due-date cell empty for a charge that carries no due date', () => {
    mount([CHARGE_SETTLED]);

    const cells = cellsOf(renderedRows()[0]);

    // The payload sent no date, so the cell carries nothing at all: no dash, no `N/A`, no `null` and
    // no `Invalid Date` the parser might have handed the pipe (Rule 1 clause 3).
    expect(cells[1]).toBe('');
    expect(cells[1] ?? '').not.toMatch(/^(?:[-–—]+|n\/?a|null|undefined|invalid date)$/i);
  });
});
