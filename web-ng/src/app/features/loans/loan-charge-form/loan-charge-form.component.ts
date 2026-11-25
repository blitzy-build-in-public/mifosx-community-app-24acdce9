import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError, toApiError } from '../../../core/http/api-error';
import { fromFineractDate } from '../../../shared/date-format.util';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type {
  ChargeTemplate,
  LoanAccount,
  LoanCharge,
  LoanChargeActionCommand,
  LoanChargeActionRequest,
  LoanChargeOption,
  LoanChargeRequest,
  LoanTransactionTemplate,
  OptionItem,
} from '../loan.models';
import { LoanService } from '../loan.service';

/**
 * Charge time type whose charge falls due on a date the user picks, as the legacy add-charge screen
 * tests it: `chargeTimeType.id == 2` in `AddLoanChargeController.submit()` and in the `ng-show` that
 * reveals its due-date field.
 *
 * `LoanChargeOption.chargeTimeType` carries that opaque id and the server's display text, and no
 * named marker, so the legacy screen's own test is reproduced here rather than a rule invented: a
 * charge of this time type reveals the due-date control, requires it, and has its value posted as
 * `dueDate` (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 3).
 */
const SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID = 2;

/**
 * Which of the two routes — and which operation within them — this instance serves, resolved once
 * from the route parameters before any request is made.
 *
 * `'notfound'` is a resolved outcome rather than an error: a `:action` the application does not
 * serve, a route without the `:id` it needs, or a charge the loan does not carry. A screen in that
 * mode issues no request at all and offers no form.
 */
type LoanChargeFormMode = 'add' | 'pay' | 'waive' | 'notfound';

/**
 * The add-charge body this screen assembles, less the two members `LoanService` writes itself.
 *
 * `LoanChargeRequest` declares `dateFormat` and `locale` required because they belong to the payload
 * that leaves the process, and `LoanService`'s serialiser fills both from configuration at the
 * boundary. A feature component that set them would hold the one date-format pattern the contract
 * fixes a second time (Rule 1 clause 2; AAP 0.14.1), so the body is assembled without them and
 * reconciled with the model in `buildAddRequest`.
 */
type AddChargeBody = Omit<LoanChargeRequest, 'dateFormat' | 'locale'>;

/**
 * The `?command=pay` body this screen assembles, less `dateFormat` and `locale`, for the reason
 * {@link AddChargeBody} states. Its `command` member stays: it discriminates the request union and
 * `LoanService` drops it before the request leaves, because Fineract takes the command from the
 * query string.
 */
type PayChargeBody = Omit<
  Extract<LoanChargeActionRequest, { command: 'pay' }>,
  'dateFormat' | 'locale'
>;

/**
 * The `?command=waive` body: the amount and the discriminating command, and deliberately neither
 * `transactionDate` nor `paymentTypeId`, which the server rejects beside `command=waive`
 * (AAP 0.7.2; `LoanService.chargeAction` drops them again for any caller that supplies them).
 */
type WaiveChargeBody = Omit<
  Extract<LoanChargeActionRequest, { command: 'waive' }>,
  'dateFormat' | 'locale'
>;

/**
 * The one displayable failure a rejected service call produces.
 *
 * A request that fails reaches a screen in one of two shapes: `ApiError`, which the single HTTP
 * interceptor maps from Fineract's envelope, or the raw `HttpErrorResponse` when a test drives the
 * service without that interceptor. Both are normalised here so every HTTP path ends in a rendered
 * message rather than a swallowed rejection (AAP 0.14.2), and the Fineract text itself is passed
 * through untouched (Rule 1 clause 3).
 *
 * @param thrown Whatever a rejected observable delivered.
 * @returns The failure to render.
 */
function asApiError(thrown: unknown): ApiError {
  if (thrown instanceof ApiError) {
    return thrown;
  }

  if (thrown instanceof HttpErrorResponse) {
    return toApiError(thrown);
  }

  // Neither shape: a programming failure rather than a server answer. Its own message is reported
  // instead of being discarded, and status 0 marks it as the transport-level failure `ApiError`
  // documents for "no response received".
  return new ApiError(thrown instanceof Error ? thrown.message : '', 0);
}

/**
 * The loan charge screen of the individual-loan family: it adds a charge to a loan, and it pays or
 * waives a charge that loan already carries. One class serves all three operations, mounted by the
 * two routes the AAP declares in `loans.routes.ts` (AAP 0.7.1 row `loans`, `LoanChargeFormComponent`;
 * AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.11.1):
 *
 * - `#/addloancharge/:id` — no `:action` and no `:chargeId`: the add form.
 * - `#/loanaccountcharge/:id/:action/:chargeId` — `:action` is `pay` or `waive`. Any other action is
 *   not a screen of this application, so it resolves to `'notfound'` and issues no request.
 *
 * **What it drives.** `GET /loans/{id}/charges/template` fills the add form's charge picker,
 * `POST /loans/{id}/charges` attaches the picked charge, and
 * `POST /loans/{id}/charges/{chargeId}?command=pay` / `?command=waive` act on an attached one
 * (AAP 0.7.3 row "Loan charges"). Two further reads are already in the endpoint table and are made
 * only where the mode needs them: `GET /loans/{id}` (`associations=all`, W6's record read) supplies
 * the charge an action acts on, and `GET /loans/{id}/transactions/template?command=repayment`
 * supplies the payment types the pay form offers (AAP 0.7.3 row "W6 repayment"). No other request is
 * issued, and every URL is composed by `LoanService`: this file imports no `HttpClient` and holds no
 * Fineract path (Rule 1 clause 5; AAP 0.14.1).
 *
 * **The bodies.** Add posts `{chargeId, amount}` and `dueDate` only when the picked charge falls due
 * on a specified date; `?command=pay` posts `{amount, transactionDate, paymentTypeId}`;
 * `?command=waive` posts `{amount}` alone. Bodies are built in exactly one place each —
 * {@link buildAddRequest} and {@link buildActionRequest} — and hold numbers as numbers, dates as
 * `Date | null`, and no formatted date at all (AAP 0.7.2; AAP 0.14.1 "dates never travel as strings
 * built in a template").
 *
 * **Findings recorded here, because nothing outside this folder may change.**
 * - The specified-due-date test is the legacy screen's own `chargeTimeType.id == 2`, reproduced as
 *   `SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID`. `GET /loans/{id}/charges/template` answers such a
 *   charge with `chargeTimeType: {id: 2, code: 'chargeTimeType.specifiedDueDate', value: …}`, but
 *   `LoanChargeOption.chargeTimeType` models the id and the display text and not the code, so the id
 *   is the field this screen can read; carrying the code into the model is outside this folder.
 * - `GET /loans/{id}?associations=all` answers `charges: null` for a loan that carries none, which
 *   the look-up below reads as "no charges" rather than as a malformed record.
 * - `dateFormat` and `locale` are declared required on both request models while the serialiser
 *   writes them from configuration, so each builder assembles the body without them and reconciles
 *   it with the model in one documented assertion (see {@link AddChargeBody}).
 * - The pay form's payment types are the repayment transaction template's own list, rendered in its
 *   order, and its first entry is preselected as the legacy repayment form preselects it. When that
 *   payload carries no list the picker stays empty: a hard-coded payment type id would be a value
 *   this application invented.
 * - Legacy's pay and waive screens seeded themselves from `GET /loans/{id}/charges/{chargeId}` (with
 *   `command=pay`). That read is not in `endpoint-allowlist.json` — AAP 0.7.3 names only the four
 *   charge endpoints — so the acting charge comes from the W6 record read instead, and its
 *   `amountOutstanding` is the payment's and the waiver's default, exactly as the server reports it.
 * - Legacy's pay and waive POSTs carried no amount; AAP 0.7.2 names one on both, so both send the
 *   outstanding portion the form shows. That difference belongs in the parity report's
 *   `intentional-diff` list (AAP 0.10.5) rather than in a silent deviation.
 *
 * **Behaviour inherited rather than improved** (Rule 1 clause 3). The pickers arrive from the
 * template endpoints in the server's order and are neither sorted nor relabelled; the amount seeds
 * from the picked charge's own amount and stays editable; the only validators are the `required`
 * ones the legacy form carries — no bound, no pattern, no minimum — so Fineract's own message is
 * what the user sees; the charge-dependent fields stay hidden until a charge is picked, as the
 * legacy `isCollapsed` toggle hides them; submission is gated on the form's own validity, as the
 * legacy `rc-submit` gate is; one click sends exactly one POST through `createSubmitGuard`; and no
 * confirmation step, extra field or extra request is added.
 *
 * **Presentation** comes entirely from the global Bootstrap 3 layer: this component declares no
 * stylesheet, no inline style and no colour (Rule 1 clause 6), and its two controls are the
 * registered deliberate differences — the native date input (AAP 0.10.5 item 1) and the native
 * `<select>` (item 2). Nothing is written to the console, and no credential, session field, tenant
 * datum or host appears in this file (Rule 1 clause 9; Rule 2).
 */
@Component({
  selector: 'app-loan-charge-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    SelectFieldComponent,
  ],
  templateUrl: './loan-charge-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanChargeFormComponent implements OnInit {
  private readonly loan = inject(LoanService);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Loan the charge belongs to, taken from the route's `:id` exactly as it was written and never
   * coerced: it is passed to the service and back to the router unchanged (AAP 0.14.1).
   *
   * Empty when the route carries no `:id`, which no route of this application does; the mode then
   * resolves to `'notfound'` and nothing is requested.
   */
  readonly loanId: string = this.route.snapshot.paramMap.get('id') ?? '';

  /**
   * The route's `:chargeId`, present on the pay and waive route and absent on the add route. It is
   * the key the acting charge is looked up by; the id posted to Fineract is the charge's own numeric
   * id from the loan record, never this string.
   */
  readonly chargeId: string | null = this.route.snapshot.paramMap.get('chargeId');

  /** Which operation this instance serves; set once in the constructor. */
  readonly mode = signal<LoanChargeFormMode>('add');

  /**
   * Whether this screen has nothing to show: an unknown `:action`, a route without `:id`, a charge
   * the loan does not carry, or a 404 from the record read. The template renders the not-found
   * message in place of the form while the rest of the shell stays usable (AAP 0.7.4 state rules).
   */
  readonly notFound = signal(false);

  /** True until the mode's own reads have settled, so the template shows no half-built form. */
  readonly loading = signal(true);

  /**
   * The last rejected write or read, rendered verbatim above the form. It is cleared when a submit
   * starts, and the entered values are never reset: a server rejection leaves the form as the user
   * filled it (AAP 0.7.4).
   */
  readonly error = signal<ApiError | null>(null);

  /**
   * Charges the loan accepts, exactly as `GET /loans/{id}/charges/template` returned them — same
   * order, same labels, nothing sorted or filtered (Rule 1 clause 3).
   */
  readonly chargeOptions = signal<readonly LoanChargeOption[]>([]);

  /**
   * Payment types the pay form offers, from the repayment transaction template's `paymentTypeOptions`
   * in its own order. Empty on the add and waive routes, which offer none.
   */
  readonly paymentTypes = signal<readonly OptionItem[]>([]);

  /** The charge the user picked in the add form's picker, or `null` while none is picked. */
  readonly selectedCharge = signal<LoanChargeOption | null>(null);

  /** The charge a pay or waive action acts on, as the loan record reported it. */
  readonly charge = signal<LoanCharge | null>(null);

  /** {@link mode} narrowed for the template's three sections. */
  readonly isAddMode = computed(() => this.mode() === 'add');

  /** {@link mode} narrowed for the template's three sections. */
  readonly isPayMode = computed(() => this.mode() === 'pay');

  /** {@link mode} narrowed for the template's three sections. */
  readonly isWaiveMode = computed(() => this.mode() === 'waive');

  /**
   * Whether the picked charge falls due on a date the user must supply — the legacy
   * `chargeTimeType.id == 2` test. It reveals and requires the due-date control and is what
   * {@link buildAddRequest} posts `dueDate` for.
   */
  readonly dueDateRequired = computed(
    () => this.selectedCharge()?.chargeTimeType?.id === SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID,
  );

  /**
   * Whether the charge-dependent fields may render: in add mode once a charge is picked, the legacy
   * `isCollapsed` toggle, and on the action routes once the loan's charge has been read.
   */
  readonly formVisible = computed(() =>
    this.mode() === 'add' ? this.selectedCharge() !== null : this.charge() !== null,
  );

  /** Charge picked in the add form; `SelectValue` because a select reports the id it was given. */
  readonly chargeIdControl = new FormControl<SelectValue | null>(null);

  /** Amount charged, paid or waived — required in every mode, and bounded by nothing. */
  readonly amountControl = new FormControl<number | null>(null);

  /** Due date of a specified-due-date charge; held as a `Date` and formatted only by the service. */
  readonly dueDateControl = new FormControl<Date | null>(null);

  /** Date a charge payment is recorded on; used by the pay mode alone. */
  readonly transactionDateControl = new FormControl<Date | null>(null);

  /** Payment type id chosen from {@link paymentTypes}; used by the pay mode alone. */
  readonly paymentTypeIdControl = new FormControl<SelectValue | null>(null);

  /**
   * The five controls as one form, so the legacy `rc-submit` gate — post only what the form accepts —
   * is a single `invalid` test rather than five, and so the template may bind either this group or
   * the individual controls.
   */
  readonly form = new FormGroup({
    chargeId: this.chargeIdControl,
    amount: this.amountControl,
    dueDate: this.dueDateControl,
    transactionDate: this.transactionDateControl,
    paymentTypeId: this.paymentTypeIdControl,
  });

  /** One click, one POST: the trigger binds `busy()` and `runOnce` refuses re-entry. */
  readonly guard = createSubmitGuard();

  constructor() {
    const mode = this.resolveMode();
    this.mode.set(mode);
    this.applyValidators(mode);

    if (mode === 'notfound') {
      this.notFound.set(true);
    }

    // The amount follows the picked charge, whatever picked it: the picker writes the control and
    // this subscription seeds the amount from that option's own value (Rule 1 clause 3).
    this.chargeIdControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.applySelectedCharge(value);
      });
  }

  /** Starts the mode's own reads; a `'notfound'` screen issues none (AAP 0.7.4 state rules). */
  ngOnInit(): void {
    if (this.notFound()) {
      this.loading.set(false);
      return;
    }

    void this.load();
  }

  /**
   * Posts this screen's one request and returns to the loan record on success.
   *
   * The legacy form gates its own submission on validity (`rc-submit`), so an incomplete form is
   * marked touched — which is what reveals each field's error — and nothing is posted. A rejected
   * request becomes {@link error} and leaves every entered value in place; the interceptor has
   * already raised the notification for a 5xx or a transport failure, so no second message is added
   * here (AAP 0.7.4).
   *
   * Wrapped in `createSubmitGuard`, so a second click while the request is in flight is refused:
   * Fineract's action endpoints are not idempotent and one click sends exactly one POST (AAP 0.1.1,
   * 0.14.1; workflow W5's "one POST per action").
   */
  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    await this.guard.runOnce(async () => {
      this.error.set(null);

      try {
        await this.post();
        await this.router.navigate(['/viewloanaccount', this.loanId]);
      } catch (thrown) {
        this.error.set(asApiError(thrown));
      }
    });
  }

  /**
   * The body `POST /loans/{id}/charges` posts: the picked charge, the amount the form shows, and the
   * due date only for a charge that falls due on a specified date (AAP 0.7.2 row
   * `LoanChargeRequest`; AAP 0.7.3 row "Loan charges").
   *
   * The amount is the form's own value — seeded from the picked option's amount and editable — sent
   * as a number, with no bound applied to it in this application (Rule 1 clause 3).
   *
   * @returns The add-charge body, ready for `LoanService.addCharge`.
   * @throws Error when called with no charge picked; `submit()` posts only a form it has validated.
   */
  buildAddRequest(): LoanChargeRequest {
    const charge = this.selectedCharge();

    if (charge === null) {
      throw new Error('No charge is selected, so the add-charge form has no body to post.');
    }

    const body: AddChargeBody = { chargeId: charge.id, amount: this.requireAmount() };
    const dueDate = this.dueDateControl.value;

    if (this.dueDateRequired() && dueDate !== null) {
      body.dueDate = dueDate;
    }

    // `LoanChargeRequest` types the payload's final shape, `dateFormat` and `locale` included, and
    // `LoanService` writes both from configuration as the request is serialised. This is the one
    // place the body assembled above meets that model, so no date pattern reaches this file.
    return body as LoanChargeRequest;
  }

  /**
   * The body `POST /loans/{id}/charges/{chargeId}?command=` posts, shaped by the resolved mode
   * (AAP 0.7.2 row `LoanChargeActionRequest`).
   *
   * `pay` books a money movement, so it carries the amount, the date it is recorded on and a payment
   * type. `waive` books none, so it carries the amount alone: no `transactionDate` and no
   * `paymentTypeId` are set on it, not even as `null`, because the server rejects both beside
   * `command=waive`.
   *
   * @returns The action body, ready for `LoanService.chargeAction`.
   * @throws Error when no amount is entered, or — in pay mode — when no payment type is chosen.
   */
  buildActionRequest(): LoanChargeActionRequest {
    const amount = this.requireAmount();

    if (this.mode() === 'waive') {
      const waived: WaiveChargeBody = { command: 'waive', amount };

      // `LoanChargeActionRequest` types the payload's final shape; the two members it declares and
      // this screen omits are written by `LoanService` as the request is serialised.
      return waived as LoanChargeActionRequest;
    }

    const paid: PayChargeBody = {
      command: 'pay',
      amount,
      transactionDate: this.transactionDateControl.value,
      paymentTypeId: this.requirePaymentTypeId(),
    };

    // As above: the serialiser supplies `dateFormat` and `locale`, so the body carries neither.
    return paid as LoanChargeActionRequest;
  }

  /**
   * Resolves which operation the route asks for, from the parameter names `loans.routes.ts` declares.
   *
   * `:chargeId` absent is the add route; present, `:action` must be `pay` or `waive`. Everything else
   * — an unknown action, a charge-scoped route without an `:action`, a route without `:id` — is
   * `'notfound'`, so no request is made for a screen this application does not serve (AAP 0.9.2).
   */
  private resolveMode(): LoanChargeFormMode {
    const params = this.route.snapshot.paramMap;
    const action = params.get('action');

    if (this.loanId === '') {
      return 'notfound';
    }

    if (this.chargeId === null) {
      return action === null ? 'add' : 'notfound';
    }

    return action === 'pay' || action === 'waive' ? action : 'notfound';
  }

  /**
   * Applies the `required` validators the legacy form carries and no others (Rule 1 clause 3): the
   * picker in add mode, the amount in every mode, the payment date and payment type in pay mode. The
   * due date's validator is set per picked charge by {@link applyDueDateRule}.
   */
  private applyValidators(mode: LoanChargeFormMode): void {
    this.chargeIdControl.setValidators(mode === 'add' ? [Validators.required] : []);
    this.amountControl.setValidators([Validators.required]);
    this.transactionDateControl.setValidators(mode === 'pay' ? [Validators.required] : []);
    this.paymentTypeIdControl.setValidators(mode === 'pay' ? [Validators.required] : []);
    this.dueDateControl.setValidators([]);

    this.chargeIdControl.updateValueAndValidity({ emitEvent: false });
    this.amountControl.updateValueAndValidity({ emitEvent: false });
    this.transactionDateControl.updateValueAndValidity({ emitEvent: false });
    this.paymentTypeIdControl.updateValueAndValidity({ emitEvent: false });
    this.dueDateControl.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Publishes the picked charge and seeds the add form from it: the amount is the option's own
   * amount — never computed from the principal or the percentage — and the due date becomes required
   * for a charge that falls due on a specified date, exactly as the legacy screen's `selectCharge`
   * seeds it.
   */
  private applySelectedCharge(value: SelectValue | null): void {
    const option = value === null ? null : this.findChargeOption(value);

    this.selectedCharge.set(option);

    if (option === null) {
      return;
    }

    // A charge whose amount the server computes arrives without one; the field then stays as the
    // user left it and posts what they typed rather than a value invented here.
    if (option.amount !== undefined) {
      this.amountControl.setValue(option.amount);
    }

    this.applyDueDateRule(option);
  }

  /** The picked charge's own row of the template's option list, matched on the id it was given. */
  private findChargeOption(value: SelectValue): LoanChargeOption | null {
    return this.chargeOptions().find((option) => String(option.id) === String(value)) ?? null;
  }

  /**
   * Requires the due date for a charge that falls due on a specified date, and drops the requirement
   * for every other charge. The field's default is the browser's today, as the legacy controller's
   * `scope.first.date = new Date()` sets it: a form's own default date follows legacy and comes from
   * the browser clock (AAP 0.10.5 item 15).
   */
  private applyDueDateRule(option: LoanChargeOption): void {
    const specified = option.chargeTimeType?.id === SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID;

    this.dueDateControl.setValidators(specified ? [Validators.required] : []);
    this.dueDateControl.updateValueAndValidity({ emitEvent: false });

    if (specified && this.dueDateControl.value === null) {
      this.dueDateControl.setValue(new Date());
    }
  }

  /**
   * Performs the reads the resolved mode needs and nothing more, then releases the loading state.
   *
   * A failure is turned into {@link error}, except a 404 on the record read, which is the
   * not-found state AAP 0.7.4 requires to be rendered in place of the record.
   */
  private async load(): Promise<void> {
    const mode = this.mode();

    try {
      if (mode === 'add') {
        await this.loadChargeOptions();
      } else if (mode === 'pay' || mode === 'waive') {
        await this.loadActingCharge(mode);
      }
    } catch (thrown) {
      this.applyFailure(thrown);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * `GET /loans/{id}/charges/template` — the add form's charge picker, published in the server's
   * order with no sorting, filtering or renaming (AAP 0.7.3 row "Loan charges"; Rule 1 clause 3).
   */
  private async loadChargeOptions(): Promise<void> {
    const template: ChargeTemplate = await firstValueFrom(this.loan.chargeTemplateFor(this.loanId));

    this.chargeOptions.set(template.chargeOptions);
  }

  /**
   * Loads the charge a pay or waive action acts on, from the loan record the W6 row already reads
   * (`GET /loans/{id}`, `associations=all`), and seeds the form from it.
   *
   * The amount defaults to the charge's `amountOutstanding` exactly as the server reports it — never
   * recomputed, rounded or defaulted to the charge's full amount or to the principal. Pay mode then
   * reads `GET /loans/{id}/transactions/template?command=repayment` for its payment types and
   * preselects the first, as the legacy repayment form does; waive mode issues no such read and
   * renders neither a payment date nor a payment type, because the server rejects both.
   *
   * A charge the loan does not carry is not a record this screen may act on: it resolves to the
   * not-found state, and no further request is made (AAP 0.7.4).
   */
  private async loadActingCharge(mode: LoanChargeActionCommand): Promise<void> {
    const routeChargeId = this.requireRouteChargeId();
    const loan: LoanAccount = await firstValueFrom(this.loan.get(this.loanId));
    const charge = (loan.charges ?? []).find(
      (candidate) => String(candidate.id) === routeChargeId,
    );

    if (charge === undefined) {
      this.mode.set('notfound');
      this.notFound.set(true);
      return;
    }

    this.charge.set(charge);
    this.amountControl.setValue(charge.amountOutstanding);

    if (mode === 'waive') {
      return;
    }

    this.seedPaymentDate(charge);

    const template: LoanTransactionTemplate = await firstValueFrom(
      this.loan.actionTemplate(this.loanId, 'repayment'),
    );
    const paymentTypes = template.paymentTypeOptions ?? [];

    this.paymentTypes.set(paymentTypes);
    this.paymentTypeIdControl.setValue(paymentTypes[0]?.id ?? null);
  }

  /**
   * Seeds the payment date from the charge's own due date, which is what the legacy pay form does
   * (`LoanAccountActionsController`, `paycharge`), and from the browser clock when the charge carries
   * no date this parser accepts (AAP 0.10.5 item 15). The value stays editable.
   */
  private seedPaymentDate(charge: LoanCharge): void {
    this.transactionDateControl.setValue(fromFineractDate(charge.dueDate) ?? new Date());
  }

  /**
   * Records a failed read. A 404 means the loan itself is not there, which the template renders as
   * the not-found message in place of the form with the shell still usable; every other failure is
   * the server's own message, rendered verbatim above the form (AAP 0.7.4; Rule 1 clause 3).
   */
  private applyFailure(thrown: unknown): void {
    const failure = asApiError(thrown);

    if (failure.status === 404) {
      this.notFound.set(true);
      return;
    }

    this.error.set(failure);
  }

  /**
   * Posts the one request the resolved mode makes: the charge on the add route, the command on the
   * pay and waive ones. A `'notfound'` screen posts nothing, and the command travels in the query
   * string rather than the body because that is how Fineract takes it (AAP 0.7.3).
   */
  private async post(): Promise<void> {
    const mode = this.mode();

    if (mode === 'add') {
      await firstValueFrom(this.loan.addCharge(this.loanId, this.buildAddRequest()));
      return;
    }

    if (mode !== 'pay' && mode !== 'waive') {
      return;
    }

    await firstValueFrom(
      this.loan.chargeAction(
        this.loanId,
        this.requireActingCharge().id,
        mode,
        this.buildActionRequest(),
      ),
    );
  }

  /** The amount the form holds, which both bodies carry as a number. */
  private requireAmount(): number {
    const amount = this.amountControl.value;

    if (amount === null) {
      throw new Error('No amount is entered, so the charge form has no body to post.');
    }

    return amount;
  }

  /**
   * The chosen payment type's id, read from the template's own option list so the body carries the
   * number the server sent rather than a stringified copy of the select's value.
   */
  private requirePaymentTypeId(): number {
    const value = this.paymentTypeIdControl.value;
    const option =
      value === null
        ? undefined
        : this.paymentTypes().find((candidate) => String(candidate.id) === String(value));

    if (option === undefined) {
      throw new Error('No payment type is chosen, so the charge payment has no body to post.');
    }

    return option.id;
  }

  /** The route's `:chargeId`, which `resolveMode()` guarantees is present on the pay and waive routes. */
  private requireRouteChargeId(): string {
    const chargeId = this.chargeId;

    if (chargeId === null) {
      throw new Error('This route declares no :chargeId, so no charge can be acted on.');
    }

    return chargeId;
  }

  /** The loaded charge an action posts against, which the pay and waive modes load before their form. */
  private requireActingCharge(): LoanCharge {
    const charge = this.charge();

    if (charge === null) {
      throw new Error('No charge has been loaded, so the charge action has nothing to post against.');
    }

    return charge;
  }
}

