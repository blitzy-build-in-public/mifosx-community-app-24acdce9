import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import { SelectFieldComponent } from '../../../shared/select-field/select-field.component';
import type { SelectOption, SelectValue } from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { LoanService } from '../loan.service';

/**
 * The body a repayment form posts, taken from the service's own parameter type.
 *
 * Derived rather than re-declared: `LoanService.repay` takes `LoanRepaymentInput` — the repayment
 * model without `dateFormat` and `locale`, which the service writes at the boundary — so an alias of
 * that parameter is the body this component is allowed to build, and it follows the service if that
 * shape ever changes. Nothing here can add the two format members or omit one the server needs
 * (Rule 1 clause 2, AAP 0.7.2 "Date handling").
 */
type RepaymentBody = Parameters<LoanService['repay']>[1];

/**
 * The individual-loan repayment form — workflow W6 of the Agent Action Plan, mounted at
 * `#/loanaccount/:id/repayment` by `LoanActionComponent`, which renders
 * `<app-loan-repayment [loanId]="id" />` for `:action === 'repayment'` (AAP 0.7.1 Features row
 * `loans`, AAP 0.7.4 "Actions: `#/loanaccount/:id/:action`"; AAP 0.8.2 "Feature routes"). It is
 * therefore not a route target itself: the route table's six loan paths are `LoanActionComponent`'s
 * and this component adds none (AAP 0.10.4 `in-scope-routes.json`).
 *
 * **What it calls, and through what.** Two endpoints, each reached through its one owner,
 * `LoanService` (AAP 0.7.3 rows "W5 approve and disburse" and "W6 repayment"):
 *
 * - `GET /loans/{id}/transactions/template` with the `repayment` command —
 *   `actionTemplate(id, 'repayment')`, the form's whole seed: its payment types, its default amount
 *   and its default date, which are the values legacy's own repayment form is seeded from;
 * - `POST /loans/{id}/transactions` with the `repayment` command — `repay(id, body)`, once per click.
 *
 * No other request is made: the record read this screen used to make to reach the repayment schedule
 * is a request legacy's action screen never sends, and it is listed in no AAP 0.10.5 entry, so it is
 * not issued at all (Rule 1 clauses 2 and 3).
 *
 * This file holds no URL, no query parameter name, no host and no HTTP client: the service composes
 * the whole request and `core/http/fineract.interceptor.ts` attaches `Authorization` and
 * `Fineract-Platform-TenantId` (Rule 1 clause 5, Rule 2; AAP 0.4.2, AAP 0.14.1).
 *
 * **Dates.** The form's date field holds a `Date | null`, and neither it nor this component writes a
 * formatted date or the `dateFormat`/`locale` pair: `LoanService.repay` serialises the first and sets
 * the other two, so the payload the server parses is the one the legacy screen sent (AAP 0.7.2 "Date
 * handling"). The field's own default is the template's `date` when the endpoint supplies one and the
 * browser clock otherwise — legacy's behaviour, registered as a deliberate difference from reading the
 * tenant business date here (AAP 0.10.5 item 15), because a business-date request from this screen
 * would be a call legacy never makes.
 *
 * **What it does not improve.** The amount is seeded from the transaction template's own `amount` and
 * stays editable, exactly as the legacy form leaves it; it is not recomputed, rounded or bounded, and
 * the amount carries `Validators.required` and nothing else, so Fineract alone decides whether a figure
 * is acceptable (AAP 0.4.4 decision 6; Rule 1 clause 3). The payment types are the template's own list
 * in the server's order, with no sorting, filtering, relabelling or synthesised option. A failure shows
 * the server's message and leaves every entered value in place.
 *
 * **One request per click.** The POST goes through `guard.runOnce`, so a second click while the first
 * is in flight sends nothing: Fineract's action endpoints are not idempotent (AAP 0.1.1, AAP 0.14.1;
 * `shared/submit-guard.util.ts`). The trigger's disabled state is the template's `guard.busy()`.
 *
 * **One message per failure.** This component raises no notification: the interceptor already notifies
 * for a 5xx or a network failure, and this screen renders `error()` inline, so a failed submit produces
 * exactly one message and keeps the form (AAP 0.7.4). A 404 from the read sets `notFound` instead,
 * which the template renders in place of the form so the rest of the shell stays usable. Nothing is
 * written to the console: not the loan id, not a body, not a credential (Rule 1 clause 9).
 *
 * **Presentation.** No stylesheet, no inline style and no colour: the panel, the labels, the controls,
 * the invalid state and the error block are Bootstrap 3 and the legacy partials compiled into
 * `web-ng/src/styles.scss` (Rule 1 clause 6). The native date and select controls replace the legacy
 * jQuery datepicker and `chosen` plugin (AAP 0.10.5 items 1 and 2).
 *
 * **The request sequence is legacy's own.** One seed read, then one POST: the template call is the
 * read the legacy repayment form makes before it submits, and nothing else is issued here, so the
 * parity run's request ordering matches the baseline with no unregistered difference (Rule 1 clauses
 * 2 and 3).
 */
@Component({
  selector: 'app-loan-repayment',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, SelectFieldComponent],
  templateUrl: './loan-repayment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanRepaymentComponent {
  /**
   * The loan being repaid — the `:id` of `#/loanaccount/:id/repayment`, bound by
   * `LoanActionComponent` as `<app-loan-repayment [loanId]="id" />`.
   *
   * `number | string` because it arrives as a route parameter, which is the shape every
   * `LoanService` method accepts. Each value it takes re-runs the load, so reusing the screen for
   * another loan re-seeds the form instead of showing the previous loan's figures.
   */
  readonly loanId = input.required<number | string>();

  /** The loans family's typed HTTP service: the only collaborator this component injects. */
  private readonly loans = inject(LoanService);

  /** Navigation back to the record once the repayment is booked; never `window.location`. */
  private readonly router = inject(Router);

  /** The failure the template renders inline, or `null` while the last call succeeded. */
  readonly error = signal<ApiError | null>(null);

  /**
   * Whether the seed read answered 404, meaning the loan does not exist or is not visible to this user.
   *
   * Held apart from `error` because the template renders it in place of the form, where a validation
   * failure is rendered above a form the user keeps editing (AAP 0.7.4).
   */
  readonly notFound = signal(false);

  /**
   * The payment types the form offers, from the transactions template's `paymentTypeOptions`, in the
   * order the server sent them. Empty until the template arrives, and never filled from a constant.
   */
  readonly paymentTypeOptions = signal<readonly SelectOption[]>([]);

  /**
   * The form the template binds: the transaction date, the amount, the payment type and an optional
   * note.
   *
   * Two members are `null` until the user or the seed supplies them — the date field holds a
   * `Date | null` and the select holds the chosen option's `SelectValue` — while the note is
   * non-nullable and starts empty, so the body builder has one shape to read. `required` is the whole
   * validation set: no `min`, no `max` and no `pattern` is added to any control, because the only rules
   * that apply are the ones the legacy form has and Fineract enforces (AAP 0.4.4 decision 6,
   * Rule 1 clause 3).
   */
  readonly form = new FormGroup({
    transactionDate: new FormControl<Date | null>(null, Validators.required),
    transactionAmount: new FormControl<number | null>(null, Validators.required),
    paymentTypeId: new FormControl<SelectValue | null>(null, Validators.required),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /**
   * Duplicate-submission protection for the one POST: `busy()` drives the submit trigger's disabled
   * state and `runOnce` refuses re-entry, so one click sends one request (AAP 0.14.1).
   */
  readonly guard = createSubmitGuard();

  constructor() {
    // The load runs as soon as the loan id is available rather than in the constructor body: a required
    // input is not set at construction time, and reading it there would throw. Reading only the id
    // inside the effect keeps the load off every other signal it touches — the rest runs untracked — so
    // seeding the form cannot re-enter the effect and issue a second read.
    effect(() => {
      const loanId = this.loanId();

      untracked(() => void this.load(loanId));
    });
  }

  /**
   * Seeds the form once for the loan the screen was opened on, and reports what went wrong when the
   * read fails.
   *
   * One read supplies all three seeds: the template's `paymentTypeOptions` fill the picker, its `date`
   * is the date field's default and its `amount` is the amount the repayment books — the same values
   * the legacy repayment form is seeded from, so the screen issues no second call (Rule 1 clauses 2
   * and 3).
   *
   * A 404 sets `notFound`, which the template renders in place of the form; any other failure sets
   * `error`, whose message is rendered verbatim. Neither unmounts the screen, resets the form or
   * navigates. A 5xx or a transport failure leaves `error` `null`, because the interceptor owns
   * that one notification, so a failure produces one message and not two (AAP 0.7.4). The form is
   * rendered at once, not withheld while the seed reads settle: legacy shows the same empty
   * controls and fills them as its template answers, so gating them would be a change from the
   * screen being replaced (Rule 1 clause 3).
   *
   * @param loanId Loan to seed the form for, as the input supplied it.
   */
  private async load(loanId: number | string): Promise<void> {
    this.error.set(null);
    this.notFound.set(false);

    try {
      const template = await firstValueFrom(this.loans.actionTemplate(loanId, 'repayment'));

      // `OptionItem` is `{id: number, name: string}` and `SelectOption` is `{id: number | string, name}`,
      // so the template's rows are the field's options as received: no copy, no sort, no filter and no
      // relabelling, which is what keeps the picker's order and ids the server's (Rule 1 clause 3).
      this.paymentTypeOptions.set(template.paymentTypeOptions ?? []);

      // The template's own default date when it carries one, the browser clock otherwise — legacy's
      // behaviour, and the registered deliberate difference of AAP 0.10.5 item 15. The payload value is
      // parsed by `shared/date-format.util.ts`, the application's one reader of the two shapes Fineract
      // returns a date in; parsing it again here would be a second declaration of that contract.
      this.form.controls.transactionDate.setValue(fromFineractDate(template.date) ?? new Date());

      // The template's own default amount, which is the figure the server offers for the next
      // repayment. It is written only while the control is still empty, so a value the user has already
      // typed is never overwritten by a late read, and a template that carries no amount leaves the
      // field empty for the user rather than inventing one (Rule 1 clause 3).
      const amount = this.form.controls.transactionAmount;

      if (template.amount !== undefined && amount.value === null) {
        amount.setValue(template.amount);
      }
    } catch (cause: unknown) {
      const failure = toDisplayableFailure(cause);

      if (failure.status === 404) {
        this.notFound.set(true);
      } else {
        this.error.set(screenFailure(failure));
      }
    }
  }

  /**
   * The one producer of the repayment body, built from the form's own values.
   *
   * `transactionDate` travels as the `Date` the field holds — never a formatted string, because the
   * service serialises it beside the `dateFormat` and `locale` it sets — and `note` is sent only when
   * its trimmed value carries text, so an untouched note field adds no member the legacy body lacked
   * (Rule 1 clause 2). Nothing is rounded, bounded or recomputed: the amount is exactly what the field
   * shows, whether that is the template's own default or a figure the user typed.
   *
   * It answers `null` when a required control holds no usable value, which is the form-level `invalid`
   * state {@link submit} already refuses; the check is repeated here because the compiler cannot know
   * it, and it is what lets the body carry the models' non-null amount and payment type without a cast.
   *
   * @returns The body to post, or `null` when there is nothing valid to post yet.
   */
  private buildRequest(): RepaymentBody | null {
    const { transactionDate, transactionAmount, paymentTypeId, note } = this.form.getRawValue();

    if (transactionDate === null || transactionAmount === null || typeof paymentTypeId !== 'number') {
      return null;
    }

    const body: RepaymentBody = { transactionDate, transactionAmount, paymentTypeId };
    const trimmedNote = note.trim();

    if (trimmedNote !== '') {
      body.note = trimmedNote;
    }

    return body;
  }

  /**
   * Books the repayment — `POST /loans/{id}/transactions` with the `repayment` command — and returns to
   * the loan record.
   *
   * Every control is marked touched first so the fields that are missing show their invalid state, and
   * an invalid form stops there: the required-field set is the legacy form's own, and nothing else is
   * checked client-side (Rule 1 clause 3). The POST goes through `guard.runOnce`, which refuses a second
   * click while the first is in flight, so one click sends exactly one request to an endpoint that is
   * not idempotent (AAP 0.1.1, AAP 0.14.1).
   *
   * On success the screen navigates to `#/viewloanaccount/:id`, where the transaction appears and the
   * outstanding balance reflects it. On failure the 4xx `screenFailure` answers is stored in `error()`
   * for the template to render verbatim; every entered value survives, the form is not reset and the
   * screen does not navigate, which is what lets a user correct a rejected amount in place
   * (AAP 0.7.4). No notification is raised here: the interceptor already shows one for a 5xx or a
   * network failure, and `screenFailure` answers `null` for those, so a failure produces one message,
   * not two.
   *
   * @returns A promise that settles once the request has been attempted and the screen has navigated or
   *   recorded the failure.
   */
  async submit(): Promise<void> {
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const body = this.buildRequest();

    if (body === null) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        await firstValueFrom(this.loans.repay(this.loanId(), body));
        await this.router.navigate(['/viewloanaccount', this.loanId()]);
      });
    } catch (cause: unknown) {
      this.error.set(screenFailure(cause));
    }
  }
}

