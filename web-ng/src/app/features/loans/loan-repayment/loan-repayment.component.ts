import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import type { LoanTransactionTemplate } from '../loan.models';
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
 * **The amount, and where it comes from.** The form's default is the repayment transaction template's
 * own `amount`, which is the member the legacy repayment form itself defaults from, and it stays
 * editable exactly as legacy leaves it: it is not recomputed, rounded or bounded, and the amount carries
 * `Validators.required` and nothing else, so Fineract alone decides whether a figure is acceptable
 * (AAP 0.4.4 decision 6; Rule 1 clause 3). Measured against the fork, that figure is the next period's
 * total due: on a freshly disbursed loan it equals the first repayment period's `totalDueForPeriod`
 * (466.67 for the parity loan's schedule), and once a repayment has been booked it is that period's
 * unpaid remainder (75.00 on a loan of the same product whose first period is already paid). The
 * schedule W6's outcome is defined against is therefore not read here: deriving the default from
 * `repaymentSchedule` would cost the record read legacy never sends (above), and it would read the wrong
 * row — `periods[0]` is Fineract's disbursement pseudo-period, which carries no `period` number and a
 * `totalDueForPeriod` of 0.00 — so that derivation would default the amount to zero (AAP 0.10.1 W6,
 * AAP 0.10.2; Rule 1 clauses 2 and 3).
 *
 * **What it does not improve.** The payment types are the template's own list in the server's order,
 * with no sorting, filtering, relabelling or synthesised option, and the first of them is preselected
 * exactly as the legacy repayment form preselects it — the select carries no blank row to choose instead
 * and no `required` rule, because legacy's does not (Rule 1 clause 3; AAP 0.7.2). A failure shows the
 * server's message and leaves every entered value in place.
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
 *
 * **One instance, one loan.** `LoanActionComponent` holds a single subscription to the route's
 * parameter map and re-binds `[loanId]` on every emission of it, so the router reuses this component
 * as the URL moves from one loan's repayment route to another. Each run of {@link load} therefore
 * empties the form and the picker before it reads, and only the newest run may seed them, so what the
 * screen shows is always what the loan in the URL was seeded with — never the previous loan's amount
 * or payment type, which could otherwise be posted against the loan the form now names.
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
   * `LoanService` method accepts. `LoanActionComponent` keeps its subscription to the route's
   * parameter map and re-binds this input on every emission, so the router reuses this component
   * when the URL moves from one loan's repayment route to another. Each new value therefore starts
   * a run of {@link load} that empties the previous loan's options and entered values before it
   * reads, and only the newest run may seed the form — a figure left over from the loan the URL has
   * left can never be posted against the loan it names now.
   */
  readonly loanId = input.required<number | string>();

  /** The loans family's typed HTTP service: the only collaborator this component injects. */
  private readonly loans = inject(LoanService);

  /** Navigation back to the record once the repayment is booked; never `window.location`. */
  private readonly router = inject(Router);

  /**
   * This component's lifetime, so a seed read whose screen has since been torn down writes nothing:
   * see {@link isCurrent}.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Which seed read is the current one, incremented by every run of {@link load}.
   *
   * The router reuses this component across the repayment route of every loan, so moving in place
   * starts a second read while the first is still in flight and the earlier one can answer last. A
   * superseded run compares its own number with this one after the await and writes nothing — not the
   * payment types, not the seeded date or amount, not the failure — which is the guard `loan-edit`,
   * `loan-charge-form` and the savings screens keep over their own load sequences.
   */
  private loadSequence = 0;

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
   * non-nullable and starts empty, so the body builder has one shape to read. The date and the amount
   * carry `Validators.required` because the legacy form requires them and AAP 0.7.2 makes them the
   * repayment's two required members; the payment type carries no validator at all, because legacy's
   * repayment select carries no `required` marker and the server accepts a repayment without one
   * (Rule 1 clause 3; AAP 0.7.2). No `min`, no `max` and no `pattern` is added to any control either:
   * Fineract alone decides whether a figure is acceptable (AAP 0.4.4 decision 6).
   */
  readonly form = new FormGroup({
    transactionDate: new FormControl<Date | null>(null, Validators.required),
    transactionAmount: new FormControl<number | null>(null, Validators.required),
    paymentTypeId: new FormControl<SelectValue | null>(null),
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
   * Seeds the form for the loan the screen shows now — from an empty form — and reports what went
   * wrong when the read fails.
   *
   * Every run takes the next {@link loadSequence} number and empties whatever the previous run left,
   * the picker's options and every entered value included, before it reads. `LoanActionComponent`
   * re-binds this component's `loanId` on each emission of the route's parameter map, so moving from
   * one loan's repayment route to another reuses this instance: without the reset the previous
   * loan's amount and payment type would stay on the form and could be posted against the new loan.
   * With it, the only figures on screen are the ones the loan the URL names was seeded with
   * (Rule 1 clause 3 — legacy re-seeds its own form from the template of the loan it is showing).
   *
   * One read supplies all three seeds: the template's `paymentTypeOptions` fill the picker, its `date`
   * is the date field's default and its `amount` is the amount the repayment books — the same values
   * the legacy repayment form is seeded from, so the screen issues no second call (Rule 1 clauses 2
   * and 3).
   *
   * Only the newest run writes anything, on the success path and on the failure path alike: an answer
   * that the URL has left, or that the screen has outlived, is discarded rather than painted.
   *
   * A 404 sets `notFound`, which the template renders in place of the form; any other failure sets
   * `error`, whose message is rendered verbatim. Neither unmounts the screen, restores another loan's
   * values or navigates: the form was emptied at the start of this run, and a failed read leaves it
   * empty for the user to fill in. A 5xx or a transport failure leaves `error` `null`, because the
   * interceptor owns that one notification, so a failure produces one message and not two
   * (AAP 0.7.4). The form is
   * rendered at once, not withheld while the seed reads settle: legacy shows the same empty
   * controls and fills them as its template answers, so gating them would be a change from the
   * screen being replaced (Rule 1 clause 3).
   *
   * @param loanId Loan to seed the form for, as the input supplied it.
   */
  private async load(loanId: number | string): Promise<void> {
    const load = ++this.loadSequence;

    this.error.set(null);
    this.notFound.set(false);
    this.resetForm();

    try {
      const template = await firstValueFrom(
        this.loans.actionTemplate(loanId, 'repayment').pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (this.isCurrent(load)) {
        this.seedForm(template);
      }
    } catch (cause: unknown) {
      if (!this.isCurrent(load)) {
        return;
      }

      const failure = toDisplayableFailure(cause);

      if (failure.status === 404) {
        this.notFound.set(true);
      } else {
        this.error.set(screenFailure(failure));
      }
    }
  }

  /**
   * Puts the form and the picker back to the empty state the seed read fills.
   *
   * Called before every read, so no value entered or seeded for one loan survives into the form of
   * another: the date and the amount go back to `null`, the select to no choice, the note to the
   * empty string its non-nullable control holds, and the picker to no options. Nothing else is reset
   * — not the error, not the submit guard — because those are the run's own to set.
   */
  private resetForm(): void {
    this.paymentTypeOptions.set([]);
    this.form.reset({
      transactionDate: null,
      transactionAmount: null,
      paymentTypeId: null,
      note: '',
    });
  }

  /**
   * Writes one template's seeds onto the form, once the caller knows the run that read it is still
   * the current one.
   *
   * The payment types are the template's own list in the server's order, with no sorting, filtering,
   * relabelling or synthesised option, and the first of them is preselected — the default the legacy
   * repayment form itself applies (`data.paymentTypeOptions[0].id` in
   * `LoanAccountActionsController`'s repayment branch), so the select opens on a real option where
   * legacy's `ng-options` renders no blank row to choose instead. The date is the template's own when
   * it carries one and the browser clock otherwise — the registered deliberate difference of AAP
   * 0.10.5 item 15 — and the payload's date is parsed by `shared/date-format.util.ts`, the
   * application's one reader of the two shapes Fineract returns a date in. The amount is written whenever
   * the template carries one; the only condition on it is that this run is the current one, because the
   * form was emptied before the read, and a template that carries none leaves the field empty for the
   * user rather than inventing a figure. A template that offers no payment types leaves the choice empty
   * rather than refusing the repayment the server would accept (Rule 1 clause 3).
   *
   * @param template The repayment transaction template the run read.
   */
  private seedForm(template: LoanTransactionTemplate): void {
    const paymentTypeOptions = template.paymentTypeOptions ?? [];
    const defaultPaymentType: SelectOption | undefined = paymentTypeOptions[0];

    this.paymentTypeOptions.set(paymentTypeOptions);

    this.form.controls.paymentTypeId.setValue(
      defaultPaymentType === undefined ? null : defaultPaymentType.id,
    );

    this.form.controls.transactionDate.setValue(fromFineractDate(template.date) ?? new Date());

    if (template.amount !== undefined) {
      this.form.controls.transactionAmount.setValue(template.amount);
    }
  }

  /**
   * Whether a run still speaks for the screen: it is the newest run, and the screen it belongs to has
   * not been destroyed, so a read the URL left behind or the teardown cancelled can neither seed the
   * form nor report a failure that belongs to another loan.
   *
   * @param load The run's sequence number.
   */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }

  /**
   * The one producer of the repayment body, built from the form's own values.
   *
   * `transactionDate` travels as the `Date` the field holds — never a formatted string, because the
   * service serialises it beside the `dateFormat` and `locale` it sets — and `note` is sent only when
   * its trimmed value carries text, so an untouched note field adds no member the legacy body lacked
   * (Rule 1 clause 2). The payment type is sent only when the form holds one, which is what this
   * loan's template offers in every ordinary case: a template that offers none produces the body the
   * legacy form posts with an empty list, and Fineract — not a client-side rule legacy does not have —
   * decides what to make of it (Rule 1 clause 3; AAP 0.7.2 `LoanRepaymentRequest`). Nothing is
   * rounded, bounded or recomputed: the amount is exactly what the field shows, whether that is the
   * template's own default or a figure the user typed.
   *
   * It answers `null` only when the date or the amount is missing — the two members AAP 0.7.2 makes
   * required, and the only two the form refuses to submit without. The check is repeated here because
   * the compiler cannot infer it from the form's own types, and it is what lets the body carry the
   * models' non-null amount without a cast.
   *
   * @returns The body to post, or `null` when the date or the amount is still missing.
   */
  private buildRequest(): RepaymentBody | null {
    const { transactionDate, transactionAmount, paymentTypeId, note } = this.form.getRawValue();

    if (transactionDate === null || transactionAmount === null) {
      return null;
    }

    const body: RepaymentBody = {
      transactionDate,
      transactionAmount,
      ...(typeof paymentTypeId === 'number' ? { paymentTypeId } : {}),
    };
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
   * an invalid form stops there: the required set is the date and the amount, the two members legacy's
   * own form requires and AAP 0.7.2 makes required, and nothing else is checked client-side — the
   * payment type least of all, because legacy's repayment select carries no `required` marker and the
   * server accepts a repayment without one (Rule 1 clause 3). The POST goes through `guard.runOnce`,
   * which refuses a second click while the first is in flight, so one click sends exactly one request
   * to an endpoint that is not idempotent (AAP 0.1.1, AAP 0.14.1).
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

