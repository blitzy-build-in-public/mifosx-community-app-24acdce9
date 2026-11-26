import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { screenFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import { SelectFieldComponent, type SelectOption, type SelectValue, } from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { createTranslatedLabels } from '../../../shared/translated-label.util';
import type { SavingsCommand, SavingsTransactionCommand } from '../savings.models';
import { SavingsService } from '../savings.service';

/** The four `:action` segments this screen serves, spelled exactly as the legacy URL spells them (AAP 0.8.2 route `savingaccount/:id/:action`). */
type SavingsActionSegment = 'approve' | 'activate' | 'deposit' | 'withdraw';

/** Which of the saving-accounts family's two action endpoints an operation posts to: the account endpoint (`?command=approve|activate`) or the transactions endpoint (`?command=deposit|...`) — AAP 0.7.3, workflow W8. */
type SavingsOperationMode = 'action' | 'transaction';

/** Everything one route segment decides: which endpoint family it uses, the command it sends with that endpoint, and the legacy translation keys of its card heading and primary button. */
interface SavingsOperation {
  /** The route segment itself, kept so an entry can be matched against the URL it serves. */
  readonly segment: SavingsActionSegment;
  /** The endpoint family the operation uses: the account endpoint or the transactions endpoint. */
  readonly mode: SavingsOperationMode;
  /** The command sent with that endpoint, in the API's own spelling (AAP 0.7.3). */
  readonly command: SavingsCommand | SavingsTransactionCommand;
  /** Legacy flat dotted key of the card heading, resolved through `TranslatePipe`. */
  readonly headingKey: string;
  /** Legacy flat dotted key of the primary button's label. */
  readonly submitKey: string;
}

/** The operation table, the one place a route segment is turned into a Fineract command: `satisfies` keeps the table exhaustive and each entry's own literal `mode`/`command` types, so `submit()` narrows by `mode` without a cast and without a `default` branch that could send another operation's command; each heading is the title `SavingAccountActionsController.js` assigns for the same segment (Rule 1 clause 6; AAP 0.10.2). */
const OPERATIONS = {
  approve: {
    segment: 'approve', mode: 'action', command: 'approve', headingKey: 'label.heading.approvesavingaccount',
    submitKey: 'label.button.approve', }, activate: {
    segment: 'activate', mode: 'action', command: 'activate', headingKey: 'label.heading.activatesavingaccount',
    submitKey: 'label.button.activate', }, deposit: {
    segment: 'deposit', mode: 'transaction', command: 'deposit', headingKey: 'label.heading.depositmoneytosavingaccount',
    submitKey: 'label.button.deposit', }, withdraw: {
    segment: 'withdraw', mode: 'transaction',
    // The route segment and the wire command differ on purpose: legacy serves `/savingaccount/{id}/withdraw` while the endpoint takes `withdrawal`, so the segment is never normalised and this entry is the only place the two meet (AAP 0.7.3).
    command: 'withdrawal', headingKey: 'label.heading.withdrawmoneyfromsavingaccount', submitKey: 'label.button.withdraw', },
} satisfies Readonly<Record<SavingsActionSegment, SavingsOperation>>;

/** The union of the table's four entries, each keeping its own literal `mode` and `command`. */
type SavingsOperationEntry = (typeof OPERATIONS)[SavingsActionSegment];

/** The operation a raw `:action` segment names, or `null` for anything this application does not serve; `hasOwnProperty.call` rather than an `in` test refuses `toString`, `constructor` and a `null` segment instead of resolving to an inherited `Object.prototype` member. */
function resolveOperation(segment: string | null): SavingsOperationEntry | null {
  if (segment === null || !Object.prototype.hasOwnProperty.call(OPERATIONS, segment)) {
    return null;
  }

  return OPERATIONS[segment as SavingsActionSegment];
}

/** The single-purpose savings action screen — the last steps of workflow W8 at `#/savingaccount/:id/:action` (AAP 0.7.1 `savings` row, 0.7.4, 0.9.1 group 4) (AAP 0.7.4, Rule 1 clause 3, AAP 0.4.4, AAP 0.4.2). */
@Component({
  selector: 'app-savings-action', imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, SelectFieldComponent,
    HasPermissionDirective, ], templateUrl: './savings-action.component.html', changeDetection: ChangeDetectionStrategy.OnPush, })
export class SavingsActionComponent {
  /** The saving-accounts family's one typed service, the component's only Fineract collaborator. */
  private readonly savings = inject(SavingsService);
  /** The active route, subscribed to for the `:id` and `:action` segments, because the router reuses this component across action routes. */
  private readonly route = inject(ActivatedRoute);
  /** Completes the route subscription and the template read should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);
  /** Navigates back to the record once the action has been accepted. */
  private readonly router = inject(Router);
  /** The read-level savings code the route declares, so the button and the route guard cannot disagree (AAP 0.1.1, 0.11.1); an invented update-level code would hide the button from every user, and leaving it ungated would render a control the route refuses to serve. */
  readonly submitPermission = 'READ_SAVINGSACCOUNT';
  /** The account the action applies to, as the route carries the `:id`, empty when it carries none — kept as the raw string because it serves as both the service parameter and the record route, and a signal because the id has to follow every `paramMap` emission. */
  readonly id = signal('');
  /** The operation the current `:action` segment names, or `null` for a segment this application lacks; re-resolved on every emission, so a reused component serves the operation the URL now names. */
  readonly operation = signal<SavingsOperationEntry | null>(null);
  /** Whether the route names a screen this application serves; true for a missing id as well as an unknown action, set on every emission so the verdict of the route the URL has left cannot survive the move. */
  readonly notFound = signal<boolean>(false);
  /** Which template read is the current one, incremented by every run of {@link loadPaymentTypes}: moving in place starts a second read while the first is in flight, so a superseded run compares its own number after the await and writes neither payment types nor failure — the guard `loan-edit` and `client-actions` keep over their own load sequence. */
  private loadSequence = 0;
  /** The failure to show above the form, already verbatim from Fineract, or `null` while there is none; a failed submit leaves every entered value in place because the form is never reset or unmounted (AAP 0.7.4), and `screenFailure` fills it for a 4xx only. */
  readonly error = signal<string | null>(null);
  /** One request per click: the guard refuses re-entry while a call is in flight (AAP 0.4.2). */
  readonly guard = createSubmitGuard();
  /** The payment types a cash transaction may name, from the transactions template: empty until it answers, then mapped one-for-one into the select field's `{id, name}` shape in the payload's order (AAP 0.4.4 decision 6, Rule 1 clause 3). */
  readonly paymentTypes = signal<readonly SelectOption[]>([]);
  /** The approval form: the one date the approve command takes, defaulting to the browser clock exactly as the legacy form does. The tenant business date is deliberately not read here (AAP 0.10.5 item 15, 0.12): it belongs to the parity harness, and a read inside the application would add a request the legacy screens never send. */
  readonly approveForm = new FormGroup({ approvedOnDate: new FormControl<Date | null>(new Date(), { validators: [Validators.required], }), });
  /** The activation form: the one date the activate command takes, held in its own group so the two body shapes stay distinct and each command can only send its own date member (AAP 0.7.2 one shape per command). */
  readonly activateForm = new FormGroup({ activatedOnDate: new FormControl<Date | null>(new Date(), { validators: [Validators.required], }), });
  /** The cash-transaction form both deposit and withdraw share; the date and the amount are `required` and nothing more — no range, no positivity rule, no step — because the legacy screen marks those two and the server remains the authority (Rule 1 clause 3, AAP 0.7.2). The payment type carries no client-side rule at all, because legacy's transaction select marks neither the control nor its label, so an empty selection travels as `null` for the server's own message (AAP 0.4.4 decision 6). */
  readonly transactionForm = new FormGroup({
    transactionDate: new FormControl<Date | null>(new Date(), { validators: [Validators.required], }), transactionAmount: new FormControl<number | null>(null, {
      validators: [Validators.required], }), paymentTypeId: new FormControl<SelectValue | null>(null), });
  /** Resolves the labels the two shared field components take as plain display text: one signal per legacy key, re-resolved on a language switch and on a bundle arriving rather than frozen at the first paint (`shared/translated-label.util.ts`). A field initializer is an injection context, which the factory requires. */
  private readonly translated = createTranslatedLabels();
  /** Already-translated label of the approve and activate date fields. */
  readonly dateLabel = this.translated('label.heading.date');
  /** Already-translated label of the transaction date field. */
  readonly transactionDateLabel = this.translated('label.heading.transactiondate');
  /** Already-translated label of the amount field. */
  readonly amountLabel = this.translated('label.input.transactionamount');
  /** Already-translated label of the payment type select. */
  readonly paymentTypeLabel = this.translated('label.input.paymenttype');
  /** Already-translated text of the payment type select's empty option. */
  readonly paymentTypePlaceholder = this.translated('label.selectone');
  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';
  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';
  /** Subscribes to the route's parameters, which is the screen's whole entry point: one subscription and never a `snapshot` read beside it, because the router reuses this component across action routes and a single read would leave the first operation's form, payment types and message on screen. Each emission resolves the operation again, resets the screen and re-runs the one read a cash transaction needs. */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.id.set(params.get('id') ?? '');
        this.operation.set(resolveOperation(params.get('action')));
        this.reset();
        void this.loadPaymentTypes();
      });
  }
  /** Clears everything the previous route put on the screen, so an emission for another account or operation never shows the earlier entered values, payment types or message; the three forms go back to their own defaults — the browser clock for each date, which is legacy's default (AAP 0.10.5 item 15) — and the not-found verdict is re-taken. */
  private reset(): void {
    this.notFound.set(this.id() === '' || this.operation() === null);
    this.error.set(null);
    this.paymentTypes.set([]);
    this.approveForm.reset({ approvedOnDate: new Date() });
    this.activateForm.reset({ activatedOnDate: new Date() });
    this.transactionForm.reset({ transactionDate: new Date(), transactionAmount: null, paymentTypeId: null, });
  }
  /** Performs the action the route selected and returns to the record on success: the not-found outcome and an unknown operation send nothing, the active form is touched first so a missing required value is reported in (AAP 0.4.2). */
  async submit(): Promise<void> {
    const operation = this.operation();
    const accountId = this.id();
    if (this.notFound() || operation === null) {
      return;
    }
    if (operation.mode === 'action') {
      await this.submitLifecycle(operation, accountId);
      return;
    }
    await this.submitTransaction(operation, accountId);
  }
  /** Posts one lifecycle command to the account endpoint — `?command=approve` with the approval date, or `?command=activate` with the activation date (AAP 0.7.3 W8 row). */
  private async submitLifecycle(operation: Extract<SavingsOperationEntry, { readonly mode: 'action' }>, accountId: string,
  ): Promise<void> {
    const form = operation.command === 'approve' ? this.approveForm : this.activateForm;
    form.markAllAsTouched();
    if (form.invalid) {
      return;
    }
    this.error.set(null);
    try {
      await this.guard.runOnce(async () => {
        if (operation.command === 'approve') {
          await firstValueFrom(this.savings.action(accountId, 'approve', { approvedOnDate: this.approveForm.controls.approvedOnDate.value, }), );
        } else {
          await firstValueFrom(this.savings.action(accountId, 'activate', { activatedOnDate: this.activateForm.controls.activatedOnDate.value, }), );
        }
        await this.router.navigate(['/viewsavingaccount', accountId]);
      });
    } catch (failure: unknown) {
      this.error.set(screenFailure(failure)?.message ?? null);
    }
  }
  /** Posts one cash transaction to the transactions endpoint (AAP 0.7.3 W8 row): the form refuses only what it validates — a missing date or amount — and never a payment type the user left unset, which travels as `null` for the server's own rule (AAP 0.4.4 decision 6, Rule 1 clause 3). */
  private async submitTransaction(operation: Extract<SavingsOperationEntry, { readonly mode: 'transaction' }>, accountId: string,
  ): Promise<void> {
    const form = this.transactionForm;
    form.markAllAsTouched();
    const transactionDate = form.controls.transactionDate.value;
    const transactionAmount = form.controls.transactionAmount.value;
    const selectedPaymentType = form.controls.paymentTypeId.value;
    if (form.invalid || transactionDate === null || transactionAmount === null) {
      return;
    }
    // A template's payment-type ids are numbers, so anything else means the field holds nothing usable: `null` travels and the server's own rule is what answers (Rule 1 clause 3).
    const paymentTypeId = typeof selectedPaymentType === 'number' ? selectedPaymentType : null;
    const command: SavingsTransactionCommand = operation.command;
    this.error.set(null);
    try {
      await this.guard.runOnce(async () => {
        await firstValueFrom(this.savings.transaction(accountId, command, { transactionDate, transactionAmount, paymentTypeId, }), );
        await this.router.navigate(['/viewsavingaccount', accountId]);
      });
    } catch (failure: unknown) {
      this.error.set(screenFailure(failure)?.message ?? null);
    }
  }
  /** Reads the cash-transaction form's template once — the payment types it offers — and publishes them: a 4xx becomes the form's own error text and leaves the form usable, a 5xx or transport failure answers `null` because the interceptor has already notified, and a run the route superseded or the screen outlived writes nothing at all. */
  private async loadPaymentTypes(): Promise<void> {
    const load = ++this.loadSequence;
    const accountId = this.id();
    if (this.notFound() || accountId === '' || this.operation()?.mode !== 'transaction') {
      return;
    }
    try {
      const template = await firstValueFrom(this.savings.transactionTemplate(accountId).pipe(takeUntilDestroyed(this.destroyRef)), );
      if (!this.isCurrent(load)) {
        return;
      }
      this.paymentTypes.set(template.paymentTypeOptions.map((option) => ({ id: option.id, name: option.name })), );
    } catch (failure: unknown) {
      if (this.isCurrent(load)) {
        this.error.set(screenFailure(failure)?.message ?? null);
      }
    }
  }
  /** Whether a read still speaks for the screen: it is the newest read, and the screen it belongs to has not been destroyed, so a cancelled read can neither publish payment types nor report a failure under another operation's URL. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
}

