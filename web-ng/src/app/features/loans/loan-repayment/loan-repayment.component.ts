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
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { SelectFieldComponent } from '../../../shared/select-field/select-field.component';
import type { SelectOption, SelectValue } from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { LoanTransactionTemplate } from '../loan.models';
import { LoanService } from '../loan.service';

/** The body a repayment form posts, taken from `LoanService.repay`'s own parameter type so it follows the service and can neither add `dateFormat`/`locale` nor omit a member the server needs (Rule 1 clause 2; AAP 0.7.2). */
type RepaymentBody = Parameters<LoanService['repay']>[1];

/** The individual-loan repayment form — workflow W6 — mounted at `#/loanaccount/:id/repayment` by `LoanActionComponent`, so it is not a route target itself (AAP 0.7.1 row `loans`, 0.7.4, 0.8.2) (AAP 0.7.3, AAP 0.10.5, AAP 0.10.1, Rule 1 clause 3). */
@Component({
  selector: 'app-loan-repayment',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    PanelCardComponent,
    SelectFieldComponent,
  ],
  templateUrl: './loan-repayment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanRepaymentComponent {
  /** The loan being repaid — the `:id` of `#/loanaccount/:id/repayment`, re-bound by `LoanActionComponent` on every emission of the route's parameter map, so each new value starts a `{@link load}` run that empties the previous loan's options and entered values before it reads; `number | string` because it arrives as a route parameter. */
  readonly loanId = input.required<number | string>();

  /** The loans family's typed HTTP service: the only collaborator this component injects. */
  private readonly loans = inject(LoanService);

  /** Navigation back to the record once the repayment is booked; never `window.location`. */
  private readonly router = inject(Router);

  /** This component's lifetime, so a seed read whose screen has since been torn down writes nothing: see {@link isCurrent}. */
  private readonly destroyRef = inject(DestroyRef);

  /** Which seed read is the current one, incremented by every run of {@link load}: a superseded run compares its own number with this one after the await and writes nothing — not the payment types, not the seeded date or amount, not the failure. */
  private loadSequence = 0;

  /** The failure the template renders inline, or `null` while the last call succeeded. */
  readonly error = signal<ApiError | null>(null);

  /** Whether the seed read answered 404, meaning the loan does not exist or is not visible to this user; held apart from `error` because the template renders it in place of the form, where a validation failure is rendered above a form the user keeps editing (AAP 0.7.4). */
  readonly notFound = signal(false);

  /** The payment types the form offers, from the transactions template's `paymentTypeOptions` in the order the server sent them; empty until the template arrives, and never filled from a constant. */
  readonly paymentTypeOptions = signal<readonly SelectOption[]>([]);

  /** The form the template binds — the transaction date, the amount, the payment type and an optional note; the date and the amount carry `Validators.required` because legacy requires them and AAP 0.7.2 makes them the repayment's two required members, the payment type carries no validator because legacy's select carries none, and no control carries `min`, `max` or `pattern` (Rule 1 clause 3; AAP 0.4.4 decision 6). */
  readonly form = new FormGroup({
    transactionDate: new FormControl<Date | null>(null, Validators.required),
    transactionAmount: new FormControl<number | null>(null, Validators.required),
    paymentTypeId: new FormControl<SelectValue | null>(null),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /** Duplicate-submission protection for the one POST: `busy()` drives the submit trigger's disabled state and `runOnce` refuses re-entry (AAP 0.14.1). */
  readonly guard = createSubmitGuard();

  constructor() {
    // The load runs from an effect on the loan id rather than in the constructor body, because a required input is not set at construction; only the id is read tracked, so seeding the form cannot re-enter the effect and issue a second read.
    effect(() => {
      const loanId = this.loanId();

      untracked(() => void this.load(loanId));
    });
  }

  /** Seeds the form for the loan the screen shows now, from an empty form, and reports what went wrong when the read fails: every run takes the next {@link loadSequence} number, empties what the previous run left — the picker's options and every entered value included — before it reads, so the previous loan's figures cannot be posted against the new one (Rule 1 clause 3, AAP 0.7.4). */
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

  /** Puts the form and the picker back to the empty state the seed read fills — date and amount to `null`, the select to no choice, the note to the empty string its control holds, the picker to no options — so no value entered or seeded for one loan survives into another's form. */
  private resetForm(): void {
    this.paymentTypeOptions.set([]);
    this.form.reset({
      transactionDate: null,
      transactionAmount: null,
      paymentTypeId: null,
      note: '',
    });
  }

  /** Writes one template's seeds onto the form, once the caller knows the run that read it is still the current one: the payment types in the server's order with the first preselected — legacy's own default, which opens the select on a real option where `ng-options` renders no blank row to choose instead (AAP 0.10.5, Rule 1 clause 3). */
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

  /** Whether a run still speaks for the screen — it is the newest run and the screen it belongs to has not been destroyed — so a read the URL left behind can neither seed the form nor report a failure that belongs to another. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }

  /** The one producer of the repayment body, built from the form's own values: `transactionDate` travels as the `Date` the field holds, which the service serialises beside the `dateFormat` and `locale` it sets; `note` is sent only when its trimmed value carries text, so an untouched field adds no member the legacy body lacked (AAP 0.7.2). */
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

  /** Books the repayment — `POST /loans/{id}/transactions` with the `repayment` command — and returns to the loan record: every control is marked touched first so missing fields show their invalid state, an invalid form stops there — the required set is the date and the amount legacy's own form requires, and nothing else is checked client-side (AAP 0.1.1, AAP 0.7.4). */
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

