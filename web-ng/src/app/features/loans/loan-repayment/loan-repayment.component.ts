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

import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import { SelectFieldComponent } from '../../../shared/select-field/select-field.component';
import type { SelectOption, SelectValue } from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { RepaymentSchedule } from '../loan.models';
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
 * The text shown when a call rejects with something the interceptor did not map to an `ApiError`.
 *
 * Every Fineract answer reaches a screen as `ApiError`, whose `message` is the server's own
 * `defaultUserMessage` rendered verbatim (AAP 0.4.2, AAP 0.4.4 decision 6). A rejection of another
 * shape is a fault in this application rather than an answer from Fineract, so it has no server text
 * to show; this fixed sentence keeps the form from displaying nothing at all, and it is deliberately
 * not translated, because no locale bundle carries wording for a fault the server never reported.
 */
const UNMAPPED_FAILURE = 'The request could not be completed.';

/**
 * Reads whatever a service rejected with into the one error type a screen renders.
 *
 * An `ApiError` is passed through untouched, so the message, the status and the field-level failures
 * are exactly what `toApiError` produced from the Fineract body and nothing re-shapes them
 * (Rule 1 clause 3: the message is surfaced verbatim). Any other rejection — a transport fault that
 * bypassed the interceptor, a thrown programming error — becomes an `ApiError` carrying its own
 * `message` when it has one, and status `0`, which is the class's own marker for "no HTTP answer"
 * (`core/http/api-error.ts`). It never logs, never inspects the request and never reads a header or a
 * body, so no session material can reach a screen through it (Rule 1 clause 9).
 *
 * @param cause The value a `firstValueFrom(...)` awaited here rejected with.
 * @returns The error the screen renders.
 */
function toDisplayableFailure(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }

  const message = cause instanceof Error && cause.message !== '' ? cause.message : UNMAPPED_FAILURE;

  return new ApiError(message, 0);
}

/**
 * The individual-loan repayment form — workflow W6 of the Agent Action Plan, mounted at
 * `#/loanaccount/:id/repayment` by `LoanActionComponent`, which renders
 * `<app-loan-repayment [loanId]="id" />` for `:action === 'repayment'` (AAP 0.7.1 Features row
 * `loans`, AAP 0.7.4 "Actions: `#/loanaccount/:id/:action`"; AAP 0.8.2 "Feature routes"). It is
 * therefore not a route target itself: the route table's six loan paths are `LoanActionComponent`'s
 * and this component adds none (AAP 0.10.4 `in-scope-routes.json`).
 *
 * **What it calls, and through what.** Three endpoints, each reached through its one owner,
 * `LoanService` (AAP 0.7.3 rows "W5 approve and disburse" and "W6 repayment"):
 *
 * - `GET /loans/{id}/transactions/template` with the `repayment` command —
 *   `actionTemplate(id, 'repayment')`, the form's seed: its payment types and its default date;
 * - `GET /loans/{id}?associations=all` — `get(id)`, read only when no schedule was passed in, to
 *   reach the repayment schedule the amount is seeded from (see {@link scheduleOf});
 * - `POST /loans/{id}/transactions` with the `repayment` command — `repay(id, body)`, once per click.
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
 * **What it does not improve.** The amount is seeded from the schedule's first period and stays
 * editable, exactly as the legacy form leaves it; it is not recomputed, rounded or bounded, and the
 * amount carries `Validators.required` and nothing else, so Fineract alone decides whether a figure is
 * acceptable (AAP 0.4.4 decision 6; Rule 1 clause 3). The payment types are the template's own list in
 * the server's order, with no sorting, filtering, relabelling or synthesised option. A failure shows
 * the server's message and leaves every entered value in place.
 *
 * **One request per click.** The POST goes through `guard.runOnce`, so a second click while the first
 * is in flight sends nothing: Fineract's action endpoints are not idempotent (AAP 0.1.1, AAP 0.14.1;
 * `shared/submit-guard.util.ts`). The trigger's disabled state is the template's `guard.busy()`.
 *
 * **One message per failure.** This component raises no notification: the interceptor already notifies
 * for a 5xx or a network failure, and this screen renders `error()` inline, so a failed submit produces
 * exactly one message and keeps the form (AAP 0.7.4). A 404 from either read sets `notFound` instead,
 * which the template renders in place of the form so the rest of the shell stays usable. Nothing is
 * written to the console: not the loan id, not a body, not a credential (Rule 1 clause 9).
 *
 * **Presentation.** No stylesheet, no inline style and no colour: the panel, the labels, the controls,
 * the invalid state and the error block are Bootstrap 3 and the legacy partials compiled into
 * `web-ng/src/styles.scss` (Rule 1 clause 6). The native date and select controls replace the legacy
 * jQuery datepicker and `chosen` plugin (AAP 0.10.5 items 1 and 2).
 *
 * Open item for the parity run, not settled here: whether the legacy repayment screen also issues the
 * record read this component's schedule fallback makes. The fallback exists because this single-purpose
 * form shares no state with the record page, and it is the one place to change if the baseline shows
 * legacy reaching the amount by another route.
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

  /**
   * A repayment schedule the parent already holds, or `null` when it holds none.
   *
   * The live path is `null`: `LoanActionComponent` binds the loan id alone, so the schedule arrives
   * through {@link scheduleOf}'s read of the loan record. A parent that does pass one costs the screen
   * no extra request — the amount is seeded from the array it supplied and `GET /loans/{id}` is not
   * issued at all — which is why the input exists even though nothing binds it today.
   */
  readonly schedule = input<RepaymentSchedule | null>(null);

  /** The loans family's typed HTTP service: the only collaborator this component injects. */
  private readonly loans = inject(LoanService);

  /** Navigation back to the record once the repayment is booked; never `window.location`. */
  private readonly router = inject(Router);

  /** Whether a seed read is in flight, so the template can withhold the form until it settles. */
  readonly loading = signal(false);

  /** The failure the template renders inline, or `null` while the last call succeeded. */
  readonly error = signal<ApiError | null>(null);

  /**
   * Whether either read answered 404, meaning the loan does not exist or is not visible to this user.
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
   * Seeds the form once for the loan the screen was opened on, and reports what went wrong when a read
   * fails.
   *
   * The template read runs first because it is the one call the form cannot do without: its payment
   * types are the only source of the options, and its `date` is the field's default. The schedule read
   * follows through {@link scheduleOf}, and the amount is seeded from it by {@link seedAmount}.
   *
   * A 404 sets `notFound`, which the template renders in place of the form; any other failure sets
   * `error`, whose message is rendered verbatim. Neither unmounts the screen, resets the form or
   * navigates, and no notification is raised here — the interceptor owns that for a 5xx or a network
   * failure, so a failure produces one message and not two (AAP 0.7.4). `loading` is cleared whichever
   * way the load settles.
   *
   * @param loanId Loan to seed the form for, as the input supplied it.
   */
  private async load(loanId: number | string): Promise<void> {
    this.loading.set(true);
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

      this.seedAmount(await this.scheduleOf(loanId));
    } catch (cause: unknown) {
      const failure = toDisplayableFailure(cause);

      if (failure.status === 404) {
        this.notFound.set(true);
      } else {
        this.error.set(failure);
      }
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The repayment schedule the amount is seeded from: the input's array when a parent supplied one, and
   * otherwise the loan record's own schedule from `GET /loans/{id}?associations=all`.
   *
   * The record read is the fallback, not a second call: it happens only while `schedule()` is `null`, so
   * a screen that was handed a schedule issues no read at all. It exists because this single-purpose
   * form shares no state with the record page that links to it, and the schedule is the only place the
   * amount can come from without hard-coding a figure. A loan whose record carries no
   * `repaymentSchedule` — an application not yet disbursed — answers `null`, and the amount then stays
   * empty for the user to enter rather than being invented (Rule 1 clause 3).
   *
   * @param loanId Loan whose record is read when no schedule was supplied.
   * @returns The schedule, or `null` when the parent supplied none and the record carries none.
   */
  private async scheduleOf(loanId: number | string): Promise<RepaymentSchedule | null> {
    const supplied = this.schedule();

    if (supplied !== null) {
      return supplied;
    }

    const account = await firstValueFrom(this.loans.get(loanId));

    return account.repaymentSchedule ?? null;
  }

  /**
   * Prefills the amount with the schedule's first period's total due — the figure workflow W6 repays
   * (AAP 0.10.1 "W6 repayment": "the first period's total due from the loan's repayment schedule").
   *
   * The value is read from the payload's `totalDueForPeriod` and nothing else: it is not recomputed from
   * `principalDue` and `interestDue`, not rounded and not bounded, so it is the number Fineract
   * calculated (Rule 1 clause 3). It is written only while the control is still empty, so a value the
   * user has already typed is never overwritten by a late read.
   *
   * @param schedule The schedule the amount is seeded from, or `null` when there is none.
   */
  private seedAmount(schedule: RepaymentSchedule | null): void {
    const first = schedule?.periods[0];
    const amount = this.form.controls.transactionAmount;

    if (first === undefined || amount.value !== null) {
      return;
    }

    amount.setValue(first.totalDueForPeriod);
  }

  /**
   * The one producer of the repayment body, built from the form's own values.
   *
   * `transactionDate` travels as the `Date` the field holds — never a formatted string, because the
   * service serialises it beside the `dateFormat` and `locale` it sets — and `note` is sent only when
   * its trimmed value carries text, so an untouched note field adds no member the legacy body lacked
   * (Rule 1 clause 2). Nothing is rounded, bounded or recomputed: the amount is exactly what the field
   * shows, whether that is the seeded first-period total or a figure the user typed.
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
   * outstanding balance reflects it. On failure the mapped `ApiError` is stored in `error()` for the
   * template to render verbatim; every entered value survives, the form is not reset and the screen does
   * not navigate, which is what lets a user correct a rejected amount in place (AAP 0.7.4). No
   * notification is raised here: the interceptor already shows one for a 5xx or a network failure, so a
   * failure produces one message, not two.
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
      this.error.set(toDisplayableFailure(cause));
    }
  }
}

