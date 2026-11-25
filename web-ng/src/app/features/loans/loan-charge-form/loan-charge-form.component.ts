import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ChargeTemplate, LoanChargeOption } from '../loan.models';
import {
  LoanService,
  type LoanChargeActionInput,
  type LoanChargeInput,
} from '../loan.service';

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
 * Which of the two routes — and which operation within them — the current route parameters name,
 * resolved from every emission of the route's parameter map before that emission's request is made.
 *
 * `'notfound'` is a resolved outcome rather than an error: an `:action` the application does not
 * serve, or a route without the `:id` it needs. A screen in that mode issues no request at all and
 * offers no form. A charge the loan does not carry is not this screen's verdict to make: the POST
 * answers 404 with the server's own message, which `applyFailure` renders in the inline error region.
 */
type LoanChargeFormMode = 'add' | 'pay' | 'waive' | 'notfound';

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
 * `POST /loans/{id}/charges/{loanChargeId}?command=pay` / `?command=waive` act on a charge the loan
 * already carries (AAP 0.7.3 row "Loan charges"). Add issues that one read; pay and waive issue none
 * at all, because both post only what their own field collects and the bodies the endpoint accepts
 * carry nothing this screen would have to read the loan for. Every URL is composed by `LoanService`:
 * this file imports no `HttpClient` and holds no Fineract path (Rule 1 clause 5; AAP 0.14.1).
 *
 * **The path segment is the loan-charge id.** `:chargeId` on
 * `#/loanaccountcharge/:id/:action/:chargeId` is the `id` of the charge row the loan carries — the
 * `resourceId` the add call answers — and it is posted as the endpoint's `{loanChargeId}` segment
 * unchanged. It is not the charge definition id the picker offers: a definition id there answers 404
 * "Loan charge with identifier … does not exist for loan …" (see `LoanService.chargeAction`).
 *
 * **One route emission, one screen.** `:id`, `:chargeId` and `:action` are read from
 * `route.paramMap`, never from the snapshot: the router reuses this component when the URL moves from
 * one charge route to another — a loan record's charge links carry the loan's own id, and its pay and
 * waive links carry one charge of it — so a single read would leave the first loan's charge screen, its
 * picker and its message in place and would issue no request at all. Every emission therefore resolves
 * the mode again, clears the picker, the form values and the failure, and re-reads what the new route
 * needs, exactly as `loan-edit` handles the same reuse; an answer that arrives after the URL moved on is
 * discarded rather than painted, and leaving the screen cancels the read it left outstanding.
 *
 * **The bodies.** Add posts `{chargeId, amount}` and `dueDate` only when the picked charge falls due
 * on a specified date; `?command=pay` posts `{transactionDate}`; `?command=waive` posts nothing
 * beyond the format pair the service adds. Neither action posts an amount or a payment type, because
 * the endpoint pays or waives the charge's whole outstanding portion and refuses both members on the
 * parameter binding, so neither is collected here. Bodies are built in exactly one place each —
 * {@link buildAddRequest} and {@link buildActionRequest} — and hold numbers as numbers, dates as
 * `Date | null`, and no formatted date at all (AAP 0.7.2; AAP 0.14.1 "dates never travel as strings
 * built in a template"). Each returns the service's own input type, so a member the payload cannot
 * carry is a compile error rather than an assertion.
 *
 * **Findings recorded here, because nothing outside this folder may change.**
 * - The specified-due-date test is the legacy screen's own `chargeTimeType.id == 2`, reproduced as
 *   `SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID`. `GET /loans/{id}/charges/template` answers such a
 *   charge with `chargeTimeType: {id: 2, code: 'chargeTimeType.specifiedDueDate', value: …}`, but
 *   `LoanChargeOption.chargeTimeType` models the id and the display text and not the code, so the id
 *   is the field this screen can read; carrying the code into the model is outside this folder.
 * - Legacy's pay screen seeded its payment date from `GET /loans/{id}/charges/{chargeId}`, the charge's
 *   own terms. That read is not in `endpoint-allowlist.json` — AAP 0.7.3 names the four charge
 *   endpoints, and the allowlist is not this screen's to grow — so this screen issues no read at all and
 *   the payment date defaults from the browser clock, which AAP 0.10.5 item 15 registers as legacy's own
 *   behaviour for a form's default date.
 *
 * **Behaviour inherited rather than improved** (Rule 1 clause 3). The charge picker arrives from the
 * template endpoint in the server's order and is neither sorted nor relabelled; the amount seeds from
 * the picked charge's own amount and stays editable; the only validators are the `required` ones the
 * legacy form carries — no bound, no pattern, no minimum — so Fineract's own message is what the user
 * sees; the charge-dependent fields stay hidden until a charge is picked, as the legacy `isCollapsed`
 * toggle hides them; submission is gated on the form's own validity, as the legacy `rc-submit` gate
 * is; one click sends exactly one POST through `createSubmitGuard`; and no confirmation step, extra
 * field or extra request is added.
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
export class LoanChargeFormComponent {
  private readonly loan = inject(LoanService);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Loan the charge belongs to, taken from the route's `:id` exactly as it was written and never
   * coerced: it is passed to the service and back to the router unchanged (AAP 0.14.1).
   *
   * Empty when the route carries no `:id`, which no route of this application does; the mode then
   * resolves to `'notfound'` and nothing is requested. A signal, not a snapshot value: the router
   * reuses this component across charge routes, so the id has to follow every emission of
   * `route.paramMap` and every reader of it — the read, the post and the Cancel link.
   */
  readonly loanId = signal('');

  /**
   * The route's `:chargeId`, present on the pay and waive route and absent on the add route.
   *
   * It is the loan-charge id — the `id` of the charge row the loan carries, which is the
   * `resourceId` the add call answers — and it is posted as the endpoint's own path segment
   * unchanged. It is not the charge definition id the add form's picker offers: a definition id
   * there would name a charge the loan does not carry (see the class doc).
   *
   * A signal for the same reason as {@link loanId}: it is one of the segments that decides which
   * screen a reused instance is showing.
   */
  readonly chargeId = signal<string | null>(null);

  /** Which operation the route's current parameters name; re-resolved on every emission. */
  readonly mode = signal<LoanChargeFormMode>('add');

  /**
   * Which read is the current one, incremented by every run of {@link load}.
   *
   * The router reuses this component across charge routes, so moving in place starts a second read
   * while the first is still in flight and the earlier one can answer last. A superseded run compares
   * its own number with this one after the await and writes nothing — not the picker, not the failure,
   * not `loading`, which belongs to the run that replaced it — the guard `loan-edit` keeps over its own
   * load sequence.
   */
  private loadSequence = 0;

  /**
   * Whether this screen has nothing to show: an unknown `:action`, or a route without the `:id` it
   * needs. The template renders the not-found message in place of the form while the rest of the
   * shell stays usable (AAP 0.7.4 state rules).
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
   * The charge the user picked in the add form's picker, or `null` while none is picked.
   */
  readonly selectedCharge = signal<LoanChargeOption | null>(null);

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
   * Whether the fields below the picker may render: in add mode once a charge is picked — the legacy
   * `isCollapsed` toggle — and in the pay and waive modes always, because their single field is the
   * command's own rather than a charge's.
   */
  readonly formVisible = computed(() =>
    this.mode() === 'add' ? this.selectedCharge() !== null : true,
  );

  /** Charge picked in the add form; `SelectValue` because a select reports the id it was given. */
  readonly chargeIdControl = new FormControl<SelectValue | null>(null);

  /** Amount the charge is added for — required in add mode, and bounded by nothing. */
  readonly amountControl = new FormControl<number | null>(null);

  /** Due date of a specified-due-date charge; held as a `Date` and formatted only by the service. */
  readonly dueDateControl = new FormControl<Date | null>(null);

  /** Date a charge payment is recorded on; used by the pay mode alone. */
  readonly transactionDateControl = new FormControl<Date | null>(null);

  /**
   * The four controls as one form, so the legacy `rc-submit` gate — post only what the form accepts —
   * is a single `invalid` test rather than four, and so the template may bind either this group or
   * the individual controls. A control a mode does not use carries no validator and posts nothing.
   */
  readonly form = new FormGroup({
    chargeId: this.chargeIdControl,
    amount: this.amountControl,
    dueDate: this.dueDateControl,
    transactionDate: this.transactionDateControl,
  });

  /** One click, one POST: the trigger binds `busy()` and `runOnce` refuses re-entry. */
  readonly guard = createSubmitGuard();

  /**
   * Wires the picker to the amount control and subscribes to the route's parameters, which is the
   * screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: Angular reuses this component when the URL
   * moves from one charge route to another, and a single read would leave the first loan's mode,
   * picker, values and message on screen for the route the URL now names. Each emission therefore
   * resolves the mode again, resets the screen and re-runs the one read that mode needs, the way
   * `loan-edit` handles the same reuse.
   */
  constructor() {
    // The amount follows the picked charge: the picker writes the control and this subscription seeds
    // the amount from that option's own value (Rule 1 clause 3).
    this.chargeIdControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.applySelectedCharge(value);
      });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.loanId.set(params.get('id') ?? '');
        this.chargeId.set(params.get('chargeId'));

        const mode = this.resolveMode(params);

        this.mode.set(mode);
        this.reset(mode);
        void this.load();
      });
  }

  /**
   * Clears everything the previous route put on the screen, so an emission that names another loan or
   * another operation never shows the earlier picker, the earlier entered values or the earlier
   * message.
   *
   * The form is reset rather than rebuilt, because the template binds these control instances; a reset
   * also returns every control to untouched, which keeps the new screen's error markers off the form.
   * The validators then belong to the new mode, and pay mode's date returns to the browser clock —
   * legacy's own default for a form's date (AAP 0.10.5 item 15), because the charge read legacy's pay
   * screen made first is not an endpoint this application may call.
   *
   * @param mode the operation the emission resolved to.
   */
  private reset(mode: LoanChargeFormMode): void {
    this.notFound.set(mode === 'notfound');
    this.loading.set(true);
    this.error.set(null);
    this.chargeOptions.set([]);
    this.selectedCharge.set(null);
    this.form.reset();
    this.applyValidators(mode);

    if (mode === 'pay') {
      this.transactionDateControl.setValue(new Date());
    }
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

    // The loan is read once, when the click is accepted: a route emission that lands mid-flight must
    // not retarget the POST or the record the screen returns to.
    const loanId = this.loanId();

    await this.guard.runOnce(async () => {
      this.error.set(null);

      try {
        await this.post(loanId);
        await this.router.navigate(['/viewloanaccount', loanId]);
      } catch (thrown) {
        this.error.set(screenFailure(thrown));
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
  buildAddRequest(): LoanChargeInput {
    const charge = this.selectedCharge();

    if (charge === null) {
      throw new Error('No charge is selected, so the add-charge form has no body to post.');
    }

    const body: LoanChargeInput = { chargeId: charge.id, amount: this.requireAmount() };
    const dueDate = this.dueDateControl.value;

    if (this.dueDateRequired() && dueDate !== null) {
      body.dueDate = dueDate;
    }

    return body;
  }

  /**
   * The body `POST /loans/{id}/charges/{loanChargeId}?command=` posts, shaped by the resolved mode
   * (AAP 0.7.2 row `LoanChargeActionRequest`).
   *
   * `pay` books a money movement and carries the date it is recorded on. `waive` books none and
   * carries the discriminating command alone. Neither carries an amount or a payment type: the
   * endpoint pays or waives the charge's whole outstanding portion and refuses both members on the
   * parameter binding, so a value collected here would be a field the server rejects.
   *
   * @returns The action body, ready for `LoanService.chargeAction`.
   * @throws Error when the resolved mode posts no charge action at all.
   */
  buildActionRequest(): LoanChargeActionInput {
    if (this.mode() === 'pay') {
      return { command: 'pay', transactionDate: this.transactionDateControl.value };
    }

    if (this.mode() === 'waive') {
      return { command: 'waive' };
    }

    throw new Error(`The '${this.mode()}' screen posts no charge action, so it has no body to post.`);
  }

  /**
   * Resolves which operation the route asks for, from the parameter names `loans.routes.ts` declares.
   *
   * `:chargeId` absent is the add route; present, `:action` must be `pay` or `waive`. Everything else
   * — an unknown action, a charge-scoped route without an `:action`, a route without `:id` — is
   * `'notfound'`, so no request is made for a screen this application does not serve (AAP 0.9.2).
   *
   * @param params the emission's parameter map, which is also what {@link loanId} and
   *   {@link chargeId} were just set from.
   */
  private resolveMode(params: ParamMap): LoanChargeFormMode {
    const action = params.get('action');

    if (this.loanId() === '') {
      return 'notfound';
    }

    if (this.chargeId() === null) {
      return action === null ? 'add' : 'notfound';
    }

    return action === 'pay' || action === 'waive' ? action : 'notfound';
  }

  /**
   * Applies the `required` validators the legacy form carries and no others (Rule 1 clause 3): the
   * picker and the amount in add mode, and the payment date in pay mode. The due date's validator is
   * set per picked charge by {@link applyDueDateRule}.
   */
  private applyValidators(mode: LoanChargeFormMode): void {
    this.chargeIdControl.setValidators(mode === 'add' ? [Validators.required] : []);
    this.amountControl.setValidators(mode === 'add' ? [Validators.required] : []);
    this.transactionDateControl.setValidators(mode === 'pay' ? [Validators.required] : []);
    this.dueDateControl.setValidators([]);

    this.chargeIdControl.updateValueAndValidity({ emitEvent: false });
    this.amountControl.updateValueAndValidity({ emitEvent: false });
    this.transactionDateControl.updateValueAndValidity({ emitEvent: false });
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
   * Performs the read the resolved mode needs and nothing more, then releases the loading state.
   *
   * Add mode reads the charge template its picker renders. The pay and waive modes read nothing at
   * all: the bodies the charge endpoint accepts carry only what their own field collects, and the one
   * read legacy's pay and waive screens made is not an endpoint this application may call. A failure
   * becomes {@link error}, which the template renders above the form, and a 404 becomes the not-found
   * state AAP 0.7.4 requires to be rendered in place of the record. A `'notfound'` screen issues no
   * request at all (AAP 0.7.4 state rules).
   *
   * Every run takes the next {@link loadSequence} number, and the read is tied to this component's
   * lifetime, so a run the route has since superseded — or that the screen outlived — writes nothing at
   * all, and `loading` is only cleared by the run that is still current.
   */
  private async load(): Promise<void> {
    const load = ++this.loadSequence;

    try {
      if (this.mode() === 'add') {
        const options = await this.loadChargeOptions();

        if (this.isCurrent(load)) {
          this.chargeOptions.set(options);
        }
      }
    } catch (thrown) {
      if (this.isCurrent(load)) {
        this.applyFailure(thrown);
      }
    } finally {
      if (this.isCurrent(load)) {
        this.loading.set(false);
      }
    }
  }

  /**
   * `GET /loans/{id}/charges/template` — the add form's charge picker, published in the server's
   * order with no sorting, filtering or renaming (AAP 0.7.3 row "Loan charges"; Rule 1 clause 3).
   *
   * @returns the payload's `chargeOptions`, for the caller to publish once it knows the run is still
   *   the current one.
   */
  private async loadChargeOptions(): Promise<readonly LoanChargeOption[]> {
    const template: ChargeTemplate = await firstValueFrom(
      this.loan.chargeTemplateFor(this.loanId()).pipe(takeUntilDestroyed(this.destroyRef)),
    );

    return template.chargeOptions;
  }

  /**
   * Whether a run still speaks for the screen: it is the newest run, and the screen it belongs to has
   * not been destroyed, so a read the route or the teardown cancelled can neither paint nor clear the
   * loading state of whatever replaced it.
   *
   * @param load the run's sequence number.
   */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }

  /**
   * Records a failed read. A 404 means the resource itself is not there — the loan, or the charge the
   * route names — which the template renders as the not-found message in place of the form with the
   * shell still usable; any other 4xx is the server's own message, rendered verbatim above the form
   * (AAP 0.7.4; Rule 1 clause 3). A 5xx or a transport failure answers `null` from `screenFailure`,
   * because the single interceptor has already raised that failure's one notification.
   */
  private applyFailure(thrown: unknown): void {
    const failure = toDisplayableFailure(thrown);

    if (failure.status === 404) {
      this.notFound.set(true);
      return;
    }

    this.error.set(screenFailure(failure));
  }

  /**
   * Posts the one request the resolved mode makes: the charge on the add route, the command on the
   * pay and waive ones. A `'notfound'` screen posts nothing, and the command travels in the query
   * string rather than the body because that is how Fineract takes it (AAP 0.7.3).
   *
   * The charge an action acts on is the route's own `:chargeId`, which is the loan-charge id — the
   * `id` of the charge row the loan carries, never the definition id the add form's picker offers —
   * so the request names exactly the charge the record linked to. A charge the loan does not carry
   * answers 404 with the server's own message, which {@link submit} records for the inline error
   * region.
   *
   * @param loanId the loan the submission addresses, captured when the click was accepted.
   */
  private async post(loanId: string): Promise<void> {
    const mode = this.mode();

    if (mode === 'add') {
      await firstValueFrom(this.loan.addCharge(loanId, this.buildAddRequest()));
      return;
    }

    if (mode !== 'pay' && mode !== 'waive') {
      return;
    }

    await firstValueFrom(
      this.loan.chargeAction(loanId, this.requireRouteChargeId(), mode, this.buildActionRequest()),
    );
  }

  /**
   * The amount the add form holds, as the number its body carries.
   *
   * The control is typed `FormControl<number | null>`, but an accessor writes whatever its input
   * element reports, so the value is checked here and refused unless it is a finite number: the
   * charge body carries a JSON number, exactly as legacy's amount did, and a value that arrived as
   * text must never reach the server as a string (Rule 1 clauses 2 and 4).
   *
   * @returns The amount to post.
   * @throws Error when the control holds no amount, or one that is not a finite number.
   */
  private requireAmount(): number {
    const amount: unknown = this.amountControl.value;

    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new Error('No usable amount is entered, so the add-charge form has no body to post.');
    }

    return amount;
  }

  /** The route's `:chargeId`, which `resolveMode()` guarantees is present on the pay and waive routes. */
  private requireRouteChargeId(): string {
    const chargeId = this.chargeId();

    if (chargeId === null) {
      throw new Error('This route declares no :chargeId, so no charge can be acted on.');
    }

    return chargeId;
  }
}

