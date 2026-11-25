import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { SavingsCommand, SavingsTransactionCommand } from '../savings.models';
import { SavingsService } from '../savings.service';

/**
 * The four `:action` segments this screen serves, spelled exactly as the legacy URL spells them
 * (AAP 0.8.2 `savings.routes.ts` route `savingaccount/:id/:action`).
 */
type SavingsActionSegment = 'approve' | 'activate' | 'deposit' | 'withdraw';

/**
 * Which of the saving-accounts family's two action endpoints an operation posts to: the account
 * endpoint (`?command=approve|activate`) or the transactions endpoint
 * (`?command=deposit|…`) — AAP 0.7.3, workflow W8.
 */
type SavingsOperationMode = 'action' | 'transaction';

/**
 * Everything one route segment decides: which endpoint family it uses, the command it sends with
 * that endpoint, and the legacy translation keys of its card heading and primary button.
 */
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

/**
 * The operation table: the one place a route segment is turned into a Fineract command.
 *
 * `satisfies Readonly<Record<SavingsActionSegment, SavingsOperation>>` is the point of the
 * declaration rather than a plain annotation: the record makes the table exhaustive, so a segment
 * added to `SavingsActionSegment` without an entry is a compile error, while `satisfies` keeps each
 * entry's own literal `mode` and `command` types. That is what lets {@link SavingsActionComponent}
 * narrow the operation by `mode` in `submit()` without a type assertion and without a `default`
 * branch that could silently send another operation's command.
 *
 * Heading and button labels are the shipped legacy bundle's keys (Rule 1 clause 6). Three of the
 * headings have no entry in `locale-en.json`; `FineractMissingTranslationHandler` renders their
 * last key segment as readable words, so no raw dotted key can reach the user (AAP 0.10.2).
 */
const OPERATIONS = {
  approve: {
    segment: 'approve',
    mode: 'action',
    command: 'approve',
    headingKey: 'label.heading.approve',
    submitKey: 'label.button.approve',
  },
  activate: {
    segment: 'activate',
    mode: 'action',
    command: 'activate',
    headingKey: 'label.heading.activate',
    submitKey: 'label.button.activate',
  },
  deposit: {
    segment: 'deposit',
    mode: 'transaction',
    command: 'deposit',
    headingKey: 'label.heading.deposit',
    submitKey: 'label.button.deposit',
  },
  withdraw: {
    segment: 'withdraw',
    mode: 'transaction',
    // The route segment and the wire command differ on purpose: the URL legacy serves is
    // `/savingaccount/{id}/withdraw` while the endpoint takes the other spelling (AAP 0.7.3). The
    // segment is therefore never normalised, and this entry is the only place the two meet.
    command: 'withdrawal',
    headingKey: 'label.heading.withdraw',
    submitKey: 'label.button.withdraw',
  },
} satisfies Readonly<Record<SavingsActionSegment, SavingsOperation>>;

/** The union of the table's four entries, each keeping its own literal `mode` and `command`. */
type SavingsOperationEntry = (typeof OPERATIONS)[SavingsActionSegment];

/**
 * The operation a raw `:action` segment names, or `null` for anything this application does not
 * serve.
 *
 * `hasOwnProperty.call` rather than an `in` test or a bare index, so a segment such as `toString` or
 * `constructor` is refused instead of resolving to an inherited member of `Object.prototype`. A
 * `null` segment — the route matched without an `:action` — is refused the same way.
 *
 * @param segment the `:action` segment exactly as the route delivered it.
 * @returns the matching operation, or `null` when the segment names no action screen.
 */
function resolveOperation(segment: string | null): SavingsOperationEntry | null {
  if (segment === null || !Object.prototype.hasOwnProperty.call(OPERATIONS, segment)) {
    return null;
  }

  return OPERATIONS[segment as SavingsActionSegment];
}

/**
 * The text shown for a rejection the interceptor did not map to an `ApiError`.
 *
 * Every Fineract answer reaches a screen as an `ApiError` whose `message` is the server's own
 * `defaultUserMessage`, rendered verbatim (AAP 0.4.2, AAP 0.7.2). A rejection of another shape is a
 * fault in this application rather than an answer from Fineract, so it has no server text to show;
 * this fixed sentence keeps the form from displaying nothing at all, and it is deliberately not
 * translated, because no language bundle carries wording for a fault the server never reported.
 */
const UNMAPPED_FAILURE = 'The request could not be completed.';

/**
 * Reads whatever an awaited request rejected with into the text the form shows.
 *
 * An `ApiError` keeps its own message, so Fineract's word for the failure is surfaced verbatim
 * (Rule 1 clause 3, AAP 0.4.4 decision 6). Any other rejection keeps the message of an `Error` that
 * carries one, and otherwise becomes {@link UNMAPPED_FAILURE}. Nothing is logged, no request body or
 * header is read, and no session material can reach the screen through it (Rule 1 clause 9).
 *
 * @param failure the rejection reason of an awaited request.
 * @returns the text to render above the form.
 */
function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    return failure.message;
  }

  return failure instanceof Error && failure.message !== '' ? failure.message : UNMAPPED_FAILURE;
}

/**
 * The single-purpose savings action screen — the last three steps of workflow W8, at the hash route
 * `#/savingaccount/:id/:action` (AAP 0.7.1 Features row `savings`; AAP 0.7.4 "the action screens …
 * are single-purpose forms rendered in the same card, each with a primary submit and a cancel that
 * returns to the record"; AAP 0.9.1 scope group 4).
 *
 * **One route, four screens, two endpoints.** The `:action` segment selects the screen through
 * {@link OPERATIONS}:
 *
 * - `approve` — `POST /savingsaccounts/{id}?command=approve` with the form's `approvedOnDate`;
 * - `activate` — `POST /savingsaccounts/{id}?command=activate` with the form's `activatedOnDate`;
 * - `deposit` — `GET /savingsaccounts/{id}/transactions/template` for the payment types, then
 *   `POST /savingsaccounts/{id}/transactions?command=deposit`;
 * - `withdraw` — the same two calls with the transactions endpoint's own command spelling.
 *
 * A segment this application does not serve, or a route that carries no `:id`, sets `notFound`,
 * which renders the not-found message in place of the form and issues no request at all — that is
 * what makes an unknown action unable to post (AAP 0.7.4 state rules).
 *
 * **What it does not do.** This file composes no URL, names no host, no query parameter and no
 * header, and never injects the HTTP layer: {@link SavingsService} owns every path and
 * `core/http/fineract.interceptor.ts` attaches the auth and tenant headers (Rule 1 clause 5,
 * Rule 2; AAP 0.4.2, AAP 0.14.1). Every date reaches the service as a `Date | null`; the service
 * writes `dateFormat: 'dd MMMM yyyy'` and the active `locale` beside it, so no date is formatted here
 * (AAP 0.7.2 "Date handling").
 *
 * **It reproduces the legacy forms rather than improving them** (Rule 1 clause 3). The payment types
 * are the transactions template's own list in the server's order, with no sort, filter, rename or
 * hard-coded fallback; the amount carries `Validators.required` and nothing else — no range, no
 * positivity rule, no balance check — because the server owns both rules and the legacy screen adds
 * neither; Fineract's message is rendered above the form verbatim while every entered value survives.
 */
@Component({
  selector: 'app-savings-action',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    SelectFieldComponent,
    HasPermissionDirective,
  ],
  templateUrl: './savings-action.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsActionComponent {
  /** The saving-accounts family's one typed service, the component's only Fineract collaborator. */
  private readonly savings = inject(SavingsService);

  /** The active route, read once for the `:id` and `:action` segments this screen was opened on. */
  private readonly route = inject(ActivatedRoute);

  /** Navigates back to the record once the action has been accepted. */
  private readonly router = inject(Router);

  /** Supplies the labels the two shared field components take as plain display text. */
  private readonly translate = inject(TranslateService);

  /**
   * The permission the submit control is gated on.
   *
   * The plan supplies the read-level and create-level savings codes only (AAP 0.11.1
   * `savings.routes.ts`), and this is the read-level code that route declares, so the button and the
   * route guard cannot disagree (AAP 0.1.1 "a route guard and a template directive must agree, or a
   * user reaches a screen they cannot act on"). An invented update-level code would gate the button
   * on a permission the backend never issues, hiding it from every user; leaving it ungated would
   * render a control the route refuses to serve.
   */
  readonly submitPermission = 'READ_SAVINGSACCOUNT';

  /**
   * The account the action applies to: the `:id` segment as the route carries it.
   *
   * Kept as the raw string, because it is both the service's `number | string` parameter and the
   * route parameter of the record navigated to afterwards, so neither use needs a conversion.
   */
  readonly id: string = this.route.snapshot.paramMap.get('id') ?? '';

  /** The operation the `:action` segment names, or `null` for a segment this application lacks. */
  readonly operation: SavingsOperationEntry | null = resolveOperation(
    this.route.snapshot.paramMap.get('action'),
  );

  /**
   * Whether the route names a screen this application serves; true for a missing id as well as an
   * unknown action.
   *
   * A signal rather than a plain field, because a template branch reads it and {@link submit} refuses
   * on it: the not-found outcome must be unable to send a request.
   */
  readonly notFound = signal<boolean>(this.id === '' || this.operation === null);

  /**
   * The failure to show above the form, already verbatim from Fineract, or `null` while there is
   * none. A failed submit leaves every entered value in place, because the form is never reset or
   * unmounted (AAP 0.7.4), and no second notification is raised here: the interceptor owns the
   * notification for a 5xx or a network failure.
   */
  readonly error = signal<string | null>(null);

  /** One request per click: the guard refuses re-entry while a call is in flight (AAP 0.4.2). */
  readonly guard = createSubmitGuard();

  /**
   * The payment types a cash transaction may name, from the transactions template.
   *
   * Empty until the template answers, and mapped one-for-one from the payload's own list into the
   * select field's `{id, name}` shape, in the payload's order (AAP 0.4.4 decision 6, Rule 1 clause 3).
   */
  readonly paymentTypes = signal<readonly SelectOption[]>([]);

  /**
   * The approval form: the one date the approve command takes, defaulting to the browser clock
   * exactly as the legacy form does.
   *
   * The tenant business date is deliberately not read here (AAP 0.10.5 item 15): it belongs to the
   * parity harness — seed values, workflow inputs and comparisons — because a read inside the
   * application would add a request the legacy screens never send and would register as a request
   * difference in every workflow the comparison covers.
   */
  readonly approveForm = new FormGroup({
    approvedOnDate: new FormControl<Date | null>(new Date(), {
      validators: [Validators.required],
    }),
  });

  /**
   * The activation form: the one date the activate command takes.
   *
   * Held in its own group rather than shared with the approval form, so the two body shapes stay
   * distinct and each command can only ever send its own date member (AAP 0.7.2 "one shape per
   * command").
   */
  readonly activateForm = new FormGroup({
    activatedOnDate: new FormControl<Date | null>(new Date(), {
      validators: [Validators.required],
    }),
  });

  /**
   * The cash-transaction form both deposit and pay-out commands share: the date, the amount and the
   * payment type.
   *
   * The amount is `required` and nothing more — no range, no positivity rule, no step rule — because
   * the legacy screen adds none and the server remains the authority (Rule 1 clause 3, AAP 0.7.2
   * `SavingsTransactionRequest`). `paymentTypeId` is widened to `SelectValue | null` only so the
   * shared select field accepts the binding under `strictTemplates`; it is narrowed back to a
   * `number` at the submit boundary and a string id is never sent.
   */
  readonly transactionForm = new FormGroup({
    transactionDate: new FormControl<Date | null>(new Date(), {
      validators: [Validators.required],
    }),
    transactionAmount: new FormControl<number | null>(null, {
      validators: [Validators.required],
    }),
    paymentTypeId: new FormControl<SelectValue | null>(null, {
      validators: [Validators.required],
    }),
  });

  /**
   * Counts the moments at which a label must be resolved again: a language switch and a bundle
   * arriving. Both are read inside every label signal below, so a label resolved before its bundle
   * had loaded is replaced by the real wording instead of staying at the fallback for the life of
   * the screen.
   */
  private readonly labelsRevision = signal(0);

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

  constructor() {
    const refreshLabels = (): void => this.labelsRevision.update((revision) => revision + 1);
    this.translate.onLangChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);
    this.translate.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(refreshLabels);

    if (!this.notFound() && this.operation?.mode === 'transaction') {
      void this.loadPaymentTypes();
    }
  }

  /**
   * Performs the action the route selected and returns to the record on success.
   *
   * The not-found outcome and an unknown operation send nothing. Otherwise the active form is
   * touched first, so a missing required value is reported in place, and an invalid form returns
   * without issuing a request. The call itself runs inside `guard.runOnce`, so one click sends
   * exactly one request even if the button is clicked again while the first is outstanding — the
   * guarantee workflow W5 states for the loan actions and W8 needs for the same reason: Fineract's
   * action endpoints are not idempotent (AAP 0.4.2).
   *
   * A rejection becomes the form's own error text, verbatim, with every entered value intact and no
   * second notification raised; a success navigates to `#/viewsavingaccount/{id}`, whose own read
   * shows the account's new status, balance and transaction row.
   */
  async submit(): Promise<void> {
    const operation = this.operation;
    const accountId = this.id;

    if (this.notFound() || operation === null) {
      return;
    }

    if (operation.mode === 'action') {
      await this.submitLifecycle(operation, accountId);
      return;
    }

    await this.submitTransaction(operation, accountId);
  }

  /**
   * Posts one lifecycle command to the account endpoint: `?command=approve` with the approval date,
   * or `?command=activate` with the activation date (AAP 0.7.3 W8 row).
   *
   * @param operation the resolved approve or activate entry, whose `command` is its own literal.
   * @param accountId the `:id` segment, as the route carries it.
   */
  private async submitLifecycle(
    operation: Extract<SavingsOperationEntry, { readonly mode: 'action' }>,
    accountId: string,
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
          await firstValueFrom(
            this.savings.action(accountId, 'approve', {
              approvedOnDate: this.approveForm.controls.approvedOnDate.value,
            }),
          );
        } else {
          await firstValueFrom(
            this.savings.action(accountId, 'activate', {
              activatedOnDate: this.activateForm.controls.activatedOnDate.value,
            }),
          );
        }

        await this.router.navigate(['/viewsavingaccount', accountId]);
      });
    } catch (failure: unknown) {
      this.error.set(describeFailure(failure));
    }
  }

  /**
   * Posts one cash transaction to the transactions endpoint: `?command=deposit` or the command the
   * withdraw entry carries (AAP 0.7.3 W8 row).
   *
   * The payment type is narrowed to a `number` here and the form is refused while it is anything
   * else, so a string id can never be posted and the shared select field's wider value type never
   * reaches the request body.
   *
   * @param operation the resolved deposit or withdraw entry, whose `command` is its own literal.
   * @param accountId the `:id` segment, as the route carries it.
   */
  private async submitTransaction(
    operation: Extract<SavingsOperationEntry, { readonly mode: 'transaction' }>,
    accountId: string,
  ): Promise<void> {
    const form = this.transactionForm;

    form.markAllAsTouched();

    const transactionDate = form.controls.transactionDate.value;
    const transactionAmount = form.controls.transactionAmount.value;
    const paymentTypeId = form.controls.paymentTypeId.value;

    if (
      form.invalid ||
      transactionDate === null ||
      transactionAmount === null ||
      typeof paymentTypeId !== 'number'
    ) {
      return;
    }

    const command: SavingsTransactionCommand = operation.command;

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        await firstValueFrom(
          this.savings.transaction(accountId, command, {
            transactionDate,
            transactionAmount,
            paymentTypeId,
          }),
        );

        await this.router.navigate(['/viewsavingaccount', accountId]);
      });
    } catch (failure: unknown) {
      this.error.set(describeFailure(failure));
    }
  }

  /**
   * Reads the cash-transaction form's template once — the payment types it offers — and
   * publishes them.
   *
   * A failure becomes the form's own error text and leaves the form rendered and usable; the
   * notification is not repeated here, because the interceptor has already raised one for it.
   */
  private async loadPaymentTypes(): Promise<void> {
    try {
      const template = await firstValueFrom(this.savings.transactionTemplate(this.id));

      this.paymentTypes.set(
        template.paymentTypeOptions.map((option) => ({ id: option.id, name: option.name })),
      );
    } catch (failure: unknown) {
      this.error.set(describeFailure(failure));
    }
  }

  /**
   * Builds one label signal from a legacy translation key.
   *
   * The key is resolved with `instant()`, because the two shared field components take a `label` as
   * plain display text rather than a key the `TranslatePipe` could re-resolve. `instant()` answers
   * from whatever bundle is loaded at that moment, so the computed also reads `labelsRevision`,
   * which the constructor bumps on a language switch and on a bundle arriving: the first paint shows
   * the missing-translation handler's humanised wording, and the real legacy text replaces it as soon
   * as the bundle lands.
   *
   * @param key legacy key from `app/global-translations/`, served in place (Rule 1 clause 6).
   * @returns the signal the template binds to the field's `label` input.
   */
  private translated(key: string): Signal<string> {
    return computed(() => {
      this.labelsRevision();
      this.translate.currentLang();
      return this.translate.instant(key);
    });
  }
}

