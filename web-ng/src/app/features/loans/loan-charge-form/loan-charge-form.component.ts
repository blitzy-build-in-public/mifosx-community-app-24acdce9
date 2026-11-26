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
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
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

/** The legacy add-charge screen's own `chargeTimeType.id == 2` test for a specified due date, reproduced because `LoanChargeOption.chargeTimeType` models the id and the display text and not the code (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 3). */
const SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID = 2;

/** Which operation the current route parameters name, resolved from every emission before that emission's request: `'notfound'` is a resolved outcome for an action this application does not serve or a route without `:id`, and issues no request at all. */
type LoanChargeFormMode = 'add' | 'pay' | 'waive' | 'notfound';

/** The loan charge screen: it adds a charge to a loan and pays or waives one the loan already carries, mounted by `#/addloancharge/:id` and `#/loanaccountcharge/:id/:action/:chargeId`, one class serving both routes; any other `:action` is not a screen of this application, so it resolves to `'notfound'` and issues no request (AAP 0.7.1, AAP 0.7.3, Rule 1 clause 5, AAP 0.7.2). */
@Component({
  selector: 'app-loan-charge-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    PanelCardComponent,
    RecordNotFoundComponent,
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

  /** Loan the charge belongs to, taken from the route's `:id` exactly as written and never coerced; a signal because the router reuses this component across charge routes, so the id follows every emission of `route.paramMap` and every reader of it (AAP 0.14.1). */
  readonly loanId = signal('');

  /** The route's `:chargeId` — the loan-charge id, the `id` of the charge row the loan carries and the `resourceId` the add call answers, posted as the endpoint's own path segment; not the charge definition id the add form's picker offers, which names a charge the loan does not carry. A signal for the same reuse reason as {@link loanId}. */
  readonly chargeId = signal<string | null>(null);

  /** Which operation the route's current parameters name; re-resolved on every emission. */
  readonly mode = signal<LoanChargeFormMode>('add');

  /** Which read is the current one, incremented by every run of {@link load}: a superseded run compares its own number with this one after the await and writes nothing — not the picker, not the failure, not `loading`, which belongs to the run that replaced it. */
  private loadSequence = 0;

  /** Whether this screen has nothing to show — an unknown `:action`, or a route without the `:id` it needs; the template renders the not-found message in place of the form while the rest of the shell stays usable (AAP 0.7.4). */
  readonly notFound = signal(false);

  /** True until the mode's own reads have settled, so the template shows no half-built form. */
  readonly loading = signal(true);

  /** The last rejected write or read, rendered verbatim above the form; cleared when a submit starts, and the entered values are never reset, so a server rejection leaves the form as the user filled it (AAP 0.7.4). */
  readonly error = signal<ApiError | null>(null);

  /** Charges the loan accepts, exactly as `GET /loans/{id}/charges/template` returned them — same order, same labels, nothing sorted or filtered (Rule 1 clause 3). */
  readonly chargeOptions = signal<readonly LoanChargeOption[]>([]);

  /** The charge the user picked in the add form's picker, or `null` while none is picked. */
  readonly selectedCharge = signal<LoanChargeOption | null>(null);

  /** {@link mode} narrowed for the template's three sections. */
  readonly isAddMode = computed(() => this.mode() === 'add');

  /** {@link mode} narrowed for the template's three sections. */
  readonly isPayMode = computed(() => this.mode() === 'pay');

  /** {@link mode} narrowed for the template's three sections. */
  readonly isWaiveMode = computed(() => this.mode() === 'waive');

  /** Whether the picked charge falls due on a date the user must supply — the legacy `chargeTimeType.id == 2` test; it reveals and requires the due-date control and is what {@link buildAddRequest} posts `dueDate` for. */
  readonly dueDateRequired = computed(
    () => this.selectedCharge()?.chargeTimeType?.id === SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID,
  );

  /** Whether the fields below the picker may render: in add mode once a charge is picked, the legacy `isCollapsed` toggle, and always in the pay and waive modes, whose single field is the command's own rather than a charge's. */
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

  /** The four controls as one form, so the legacy `rc-submit` gate is a single `invalid` test rather than four; a control a mode does not use carries no validator and posts nothing. */
  readonly form = new FormGroup({
    chargeId: this.chargeIdControl,
    amount: this.amountControl,
    dueDate: this.dueDateControl,
    transactionDate: this.transactionDateControl,
  });

  /** One click, one POST: the trigger binds `busy()` and `runOnce` refuses re-entry. */
  readonly guard = createSubmitGuard();

  /** Wires the picker to the amount control and subscribes to the route's parameters, which is the screen's whole entry point: one subscription and never a `snapshot` read beside it, because Angular reuses this component when the URL moves from one charge route to another; each emission resolves the mode again, resets the screen and re-runs the one read that mode needs. */
  constructor() {
    // The amount follows the picked charge: the picker writes the control and this subscription seeds the amount from that option's own value (Rule 1 clause 3).
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

  /** Clears everything the previous route put on the screen, so an emission naming another loan or another operation never shows the earlier picker, values or message: the form is reset rather than rebuilt because the template binds these control instances, and pay mode's date then returns to the browser clock — legacy's own default for a form's date (AAP 0.10.5). */
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

  /** Posts this screen's one request and returns to the loan record on success: the legacy `rc-submit` gate means an incomplete form is marked touched — which reveals each field's error — and nothing is posted; a rejected request becomes `error` and keeps every entered value, and the submit guard refuses a second click while the request is in flight (AAP 0.1.1). */
  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // The loan is read once, when the click is accepted: a route emission that lands mid-flight must not retarget the POST or the record the screen returns to.
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

  /** The body `POST /loans/{id}/charges` posts: the picked charge, the amount the form shows, and the due date only for a charge that falls due on a specified date; the amount is the form's own editable value, sent as a JSON number with no bound applied here (AAP 0.7.2, Rule 1 clause 3). */
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

  /** The body `POST /loans/{id}/charges/{loanChargeId}?command=` posts, shaped by the resolved mode: `pay` books a money movement and carries the date it is recorded on, `waive` books none and carries the discriminating command alone, and neither carries an amount or a payment type, because the endpoint refuses both members on the parameter binding (AAP 0.7.2). */
  buildActionRequest(): LoanChargeActionInput {
    if (this.mode() === 'pay') {
      return { command: 'pay', transactionDate: this.transactionDateControl.value };
    }

    if (this.mode() === 'waive') {
      return { command: 'waive' };
    }

    throw new Error(`The '${this.mode()}' screen posts no charge action, so it has no body to post.`);
  }

  /** Resolves which operation the route asks for: `:chargeId` absent is the add route, present means `:action` must be `pay` or `waive`, and everything else — an unknown action, a charge-scoped route without an action, a route without `:id` — is `'notfound'`, so no request is made for a screen this application does not serve (AAP 0.9.2). */
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

  /** Applies the `required` validators the legacy form carries and no others (Rule 1 clause 3): the picker and the amount in add mode, and the payment date in pay mode; the due date's validator is set per picked charge by {@link applyDueDateRule}. */
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

  /** Publishes the picked charge and seeds the add form from it: the amount is the option's own amount, never computed from the principal or the percentage, and the due date becomes required for a charge that falls due on a specified date, exactly as the legacy screen's `selectCharge` seeds it. */
  private applySelectedCharge(value: SelectValue | null): void {
    const option = value === null ? null : this.findChargeOption(value);

    this.selectedCharge.set(option);

    if (option === null) {
      return;
    }

    if (option.amount !== undefined) {
      this.amountControl.setValue(option.amount);
    }

    this.applyDueDateRule(option);
  }

  /** The picked charge's own row of the template's option list, matched on the id it was given. */
  private findChargeOption(value: SelectValue): LoanChargeOption | null {
    return this.chargeOptions().find((option) => String(option.id) === String(value)) ?? null;
  }

  /** Requires the due date for a charge that falls due on a specified date and drops the requirement for every other charge; the field's default is the browser's today, as the legacy controller's `scope.first.date = new Date()` sets it (AAP 0.10.5 item 15). */
  private applyDueDateRule(option: LoanChargeOption): void {
    const specified = option.chargeTimeType?.id === SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID;

    this.dueDateControl.setValidators(specified ? [Validators.required] : []);
    this.dueDateControl.updateValueAndValidity({ emitEvent: false });

    if (specified && this.dueDateControl.value === null) {
      this.dueDateControl.setValue(new Date());
    }
  }

  /** Performs the read the resolved mode needs and nothing more, then releases the loading state: add mode reads the charge template its picker renders, pay and waive read nothing at all, a failure becomes {@link error} (AAP 0.7.4). */
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

  /** `GET /loans/{id}/charges/template` — the add form's charge picker, published in the server's order with no sorting, filtering or renaming (AAP 0.7.3 row "Loan charges"; Rule 1 clause 3). @returns the payload's `chargeOptions`, or an empty list when the payload carries none. */
  private async loadChargeOptions(): Promise<readonly LoanChargeOption[]> {
    const template: ChargeTemplate = await firstValueFrom(
      this.loan.chargeTemplateFor(this.loanId()).pipe(takeUntilDestroyed(this.destroyRef)),
    );

    return template.chargeOptions ?? [];
  }

  /** Whether a run still speaks for the screen — it is the newest run and the screen it belongs to has not been destroyed — so a read the route or the teardown cancelled can neither paint nor clear the loading state of whatever replaced it. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }

  /** Records a failed read: a 404 means the loan, or the charge the route names, is not there, which the template renders as the not-found message in place of the form; any other 4xx is the server's own message, rendered verbatim above the form; a 5xx or a transport failure answers `null` from `screenFailure`, because the interceptor has already raised that failure's one notification (AAP 0.7.4; Rule 1 clause 3). */
  private applyFailure(thrown: unknown): void {
    const failure = toDisplayableFailure(thrown);

    if (failure.status === 404) {
      this.notFound.set(true);
      return;
    }

    this.error.set(screenFailure(failure));
  }

  /** Posts the one request the resolved mode makes — the charge on the add route, the command on the pay and waive ones, travelling in the query string because that is how Fineract takes it; the charge an action acts on is the route's own `:chargeId`, the loan-charge id and never the definition id the picker offers (AAP 0.7.3). */
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

  /** The amount the add form holds, as the number its body carries: an accessor writes whatever its input element reports, so the value is checked here and refused unless it is a finite number — the body carries a JSON number exactly as legacy's amount did, and a value that arrived as text must never reach the server as a string. */
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

