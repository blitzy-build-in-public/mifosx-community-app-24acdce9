import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { fromFineractDate } from '../../../shared/date-format.util';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { isLoanAccount, readSelectedId } from '../loan.models';
import type { LoanAccount, LoanCharge, LoanEditRequest } from '../loan.models';
import { LoanService } from '../loan.service';
import type { LoanApplicationInput } from '../loan.service';
/** The sixteen controls of the edit form, in the order the application body carries them: `formControlName` and the rendered element's `id` are the control names themselves, because the parity page objects address the same fields by id on both front ends (`#principal`, `#numberOfRepayments`, `#repaymentEvery`, `#interestRatePerPeriod`, `#expectedDisbursementDate`, `#submittedOnDate`, `#loanOfficerId`, `#fundId`). */
interface LoanEditFormControls {
  /** `principal` — amount applied for. */
  readonly principal: FormControl<number | null>;
  /** `loanTermFrequency` — term length. */
  readonly loanTermFrequency: FormControl<number | null>;
  /** `loanTermFrequencyType` — unit of the term. */
  readonly loanTermFrequencyType: FormControl<SelectValue | null>;
  /** `numberOfRepayments` — number of instalments. */
  readonly numberOfRepayments: FormControl<number | null>;
  /** `repaymentEvery` — interval between instalments. */
  readonly repaymentEvery: FormControl<number | null>;
  /** `repaymentFrequencyType` — unit of that interval. */
  readonly repaymentFrequencyType: FormControl<SelectValue | null>;
  /** `interestRatePerPeriod` — nominal rate. */
  readonly interestRatePerPeriod: FormControl<number | null>;
  /** `interestRateFrequencyType` — unit of the rate. */
  readonly interestRateFrequencyType: FormControl<SelectValue | null>;
  /** `amortizationType` — amortisation method. */
  readonly amortizationType: FormControl<SelectValue | null>;
  /** `interestType` — interest method. */
  readonly interestType: FormControl<SelectValue | null>;
  /** `interestCalculationPeriodType` — interest calculation basis. */
  readonly interestCalculationPeriodType: FormControl<SelectValue | null>;
  /** `transactionProcessingStrategyCode` — allocation strategy, held as its code. */
  readonly transactionProcessingStrategyId: FormControl<SelectValue | null>;
  /** `expectedDisbursementDate` — expected disbursement. */
  readonly expectedDisbursementDate: FormControl<Date | null>;
  /** `submittedOnDate` — submission date. */
  readonly submittedOnDate: FormControl<Date | null>;
  /** `loanOfficerId` — optional loan officer. */
  readonly loanOfficerId: FormControl<SelectValue | null>;
  /** `fundId` — optional fund. */
  readonly fundId: FormControl<SelectValue | null>;
}
/** The template portion of `GET /loans/{id}?template=true&associations=…`, as this screen reads it: `LoanAccount` in `../loan.models` models the loan record and deliberately stops there, while the endpoint also answers the loan form's own members — the persisted term, frequency, amortisation, interest and strategy values and their option lists — read here as a documented partial projection rather than added to the family's model module (Rule 1 clause 3). */
interface LoanEditTemplateFields {
  /** `termFrequency` — the persisted term length, which the body posts as `loanTermFrequency`. */
  readonly termFrequency: number | null;
  /** `termPeriodFrequencyType.id` — the persisted term unit. */
  readonly termFrequencyType: number | null;
  /** `termFrequencyTypeOptions` — the term unit's picker rows. */
  readonly termFrequencyTypeOptions: readonly SelectOption[];
  /** `repaymentFrequencyType.id` — the persisted interval unit. */
  readonly repaymentFrequencyType: number | null;
  /** `repaymentFrequencyTypeOptions` — the interval unit's picker rows. */
  readonly repaymentFrequencyTypeOptions: readonly SelectOption[];
  /** `interestRateFrequencyType.id` — the persisted rate unit. */
  readonly interestRateFrequencyType: number | null;
  /** `interestRateFrequencyTypeOptions` — the rate unit's picker rows. */
  readonly interestRateFrequencyTypeOptions: readonly SelectOption[];
  /** `amortizationType.id` — the persisted amortisation method. */
  readonly amortizationType: number | null;
  /** `amortizationTypeOptions` — the amortisation method's picker rows. */
  readonly amortizationTypeOptions: readonly SelectOption[];
  /** `interestType.id` — the persisted interest method. */
  readonly interestType: number | null;
  /** `interestTypeOptions` — the interest method's picker rows. */
  readonly interestTypeOptions: readonly SelectOption[];
  /** `interestCalculationPeriodType.id` — the persisted calculation basis. */
  readonly interestCalculationPeriodType: number | null;
  /** `interestCalculationPeriodTypeOptions` — the calculation basis's picker rows. */
  readonly interestCalculationPeriodTypeOptions: readonly SelectOption[];
  /** `transactionProcessingStrategyCode` — the persisted allocation strategy, as its code. */
  readonly transactionProcessingStrategyCode: string | null;
  /** `transactionProcessingStrategyOptions` — the strategy picker rows, keyed by code. */
  readonly transactionProcessingStrategyOptions: readonly SelectOption[];
  /** `loanOfficerId` — the officer the loan is assigned to, when one is. */
  readonly loanOfficerId: number | null;
  /** `loanOfficerOptions` — the officer picker rows. */
  readonly loanOfficerOptions: readonly SelectOption[];
  /** `fundId` — the fund the loan draws on, when the tenant uses funds. */
  readonly fundId: number | null;
  /** `fundOptions` — the fund picker rows. */
  readonly fundOptions: readonly SelectOption[];
}
/** The seed of a screen whose payload carried none of the template members. */
const EMPTY_TEMPLATE_FIELDS: LoanEditTemplateFields = {
  termFrequency: null,
  termFrequencyType: null,
  termFrequencyTypeOptions: [],
  repaymentFrequencyType: null,
  repaymentFrequencyTypeOptions: [],
  interestRateFrequencyType: null,
  interestRateFrequencyTypeOptions: [],
  amortizationType: null,
  amortizationTypeOptions: [],
  interestType: null,
  interestTypeOptions: [],
  interestCalculationPeriodType: null,
  interestCalculationPeriodTypeOptions: [],
  transactionProcessingStrategyCode: null,
  transactionProcessingStrategyOptions: [],
  loanOfficerId: null,
  loanOfficerOptions: [],
  fundId: null,
  fundOptions: [],
};
/** The payload's own members, read by name as the loosely typed values a response carries. */
type PayloadFields = ReadonlyMap<string, unknown>;
/** Whether a value is a JSON object, the only shape an option row or an id-bearing member has. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Indexes a response body by member name so the members this file reads through {@link LoanEditTemplateFields} can be narrowed one at a time without a cast: `Object.entries` types a plain object's values as `any`, and widening the pairs here keeps every read below a checked `unknown` the narrowing helpers accept — the same boundary `loan.service.ts` uses when it serialises a request body (Rule 1 clause 4). */
function payloadFields(account: LoanAccount): PayloadFields {
  const entries: readonly (readonly [string, unknown])[] = Object.entries(account);
  return new Map(entries);
}
/** A numeric member, or `null` when the payload carried none. */
function readNumberMember(fields: PayloadFields, key: string): number | null {
  const value = fields.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** A non-empty string member, or `null` when the payload carried none. */
function readStringMember(fields: PayloadFields, key: string): string | null {
  const value = fields.get(key);
  return typeof value === 'string' && value !== '' ? value : null;
}
/** The object rows of an option list, skipping anything the payload sent in another shape. */
function readOptionRows(fields: PayloadFields, key: string): readonly Readonly<Record<string, unknown>>[] {
  const value = fields.get(key);
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: readonly unknown[] = value;
  return rows.filter(isRecord);
}
/** The rows of an option list shaped `{id: number, value: string}`, in the received order. */
function readIdOptions(fields: PayloadFields, key: string): readonly SelectOption[] {
  return readOptionRows(fields, key).flatMap((row): readonly SelectOption[] => {
    const id = row['id'];
    const name = row['value'];
    return typeof id === 'number' && typeof name === 'string' ? [{ id, name }] : [];
  });
}
/** The rows of an option list shaped `{code: string, name: string}`, keyed by their code. */
function readCodeOptions(fields: PayloadFields, key: string): readonly SelectOption[] {
  return readOptionRows(fields, key).flatMap((row): readonly SelectOption[] => {
    const code = row['code'];
    const name = row['name'];
    return typeof code === 'string' && typeof name === 'string' ? [{ id: code, name }] : [];
  });
}
/** An officer row's label: the server's `displayName`, or its names joined when it sent none. */
function readOfficerLabel(row: Readonly<Record<string, unknown>>): string | null {
  const displayName = row['displayName'];
  if (typeof displayName === 'string' && displayName !== '') {
    return displayName;
  }
  const names = [row['firstname'], row['lastname']].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
  return names.length === 0 ? null : names.join(' ');
}
/** The rows of `loanOfficerOptions`, shaped `{id, displayName, firstname, lastname}`, in order. */
function readOfficerOptions(fields: PayloadFields, key: string): readonly SelectOption[] {
  return readOptionRows(fields, key).flatMap((row): readonly SelectOption[] => {
    const id = row['id'];
    const name = readOfficerLabel(row);
    return typeof id === 'number' && name !== null ? [{ id, name }] : [];
  });
}
/** Reads the template portion of the edit payload: the persisted values and the option lists. */
function readTemplateFields(account: LoanAccount): LoanEditTemplateFields {
  const fields = payloadFields(account);
  return {
    termFrequency: readNumberMember(fields, 'termFrequency'),
    termFrequencyType: readSelectedId(fields.get('termPeriodFrequencyType')),
    termFrequencyTypeOptions: readIdOptions(fields, 'termFrequencyTypeOptions'),
    repaymentFrequencyType: readSelectedId(fields.get('repaymentFrequencyType')),
    repaymentFrequencyTypeOptions: readIdOptions(fields, 'repaymentFrequencyTypeOptions'),
    interestRateFrequencyType: readSelectedId(fields.get('interestRateFrequencyType')),
    interestRateFrequencyTypeOptions: readIdOptions(fields, 'interestRateFrequencyTypeOptions'),
    amortizationType: readSelectedId(fields.get('amortizationType')),
    amortizationTypeOptions: readIdOptions(fields, 'amortizationTypeOptions'),
    interestType: readSelectedId(fields.get('interestType')),
    interestTypeOptions: readIdOptions(fields, 'interestTypeOptions'),
    interestCalculationPeriodType: readSelectedId(fields.get('interestCalculationPeriodType')),
    interestCalculationPeriodTypeOptions: readIdOptions(
      fields,
      'interestCalculationPeriodTypeOptions',
    ),
    transactionProcessingStrategyCode: readStringMember(
      fields,
      'transactionProcessingStrategyCode',
    ),
    transactionProcessingStrategyOptions: readCodeOptions(
      fields,
      'transactionProcessingStrategyOptions',
    ),
    loanOfficerId: readSelectedId(fields.get('loanOfficerId')),
    loanOfficerOptions: readOfficerOptions(fields, 'loanOfficerOptions'),
    fundId: readSelectedId(fields.get('fundId')),
    fundOptions: readIdOptions(fields, 'fundOptions'),
  };
}
/** A select's chosen id as the number the payload posts, or `null` when nothing is chosen. */
function asNumericSelection(value: SelectValue | null): number | null {
  return typeof value === 'number' ? value : null;
}
/** A value the body cannot be built without: the form's own `required` validators are what guarantee it is set, because {@link LoanEditComponent.submit} refuses an invalid form before the body is assembled, so a missing value reports itself instead of becoming a number or a strategy nobody chose. */
function requireNumber(value: number | null, field: string): number {
  if (value === null) {
    throw new Error(`The loan edit form has no ${field} value to post.`);
  }

  return value;
}

/** A strategy code the body cannot be built without; the picker is keyed by code, not by id. */
function requireStrategyCode(value: SelectValue | null): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('The loan edit form has no transaction processing strategy to post.');
  }

  return value;
}

/** One `charges` row of the edit body, taken from the model's own row type (AAP 0.7.2, Rule 1 clause 4). */
type LoanChargeRow = NonNullable<LoanEditRequest['charges']>[number];

/** The text shown when an action rejects with something the interceptor did not map to an `ApiError` (AAP 0.4.2, AAP 0.4.4). */
const UNMAPPED_FAILURE = 'The request could not be completed.';

/** Reads whatever a call rejected with into the one error type a screen renders (Rule 1 clause 3, AAP 0.14.2, Rule 1 clause 9). */
function toDisplayableFailure(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }

  const message = cause instanceof Error && cause.message !== '' ? cause.message : UNMAPPED_FAILURE;

  return new ApiError(message, 0);
}

/** One `charges` row of the body, for a charge the loan carries (AAP 0.3.4, AAP 0.14.1, Rule 1 clause 2). */
function chargeRow(charge: LoanCharge): LoanChargeRow {
  const { id, chargeId, amountOrPercentage } = charge;

  if (typeof id !== 'number' || typeof chargeId !== 'number') {
    throw new Error('The loaded loan carries a charge this form cannot re-post.');
  }

  const dueDate = fromFineractDate(charge.dueDate);

  return {
    id,
    chargeId,
    amount: amountOrPercentage,
    ...(dueDate === null ? {} : { dueDate }),
  };
}

/** Edit form of an individual loan application: the persisted application, re-read from Fineract and posted back to the endpoint that saves it. **Two calls, and nothing else.** One read and one write: `GET /loans/{id}?template=true&associations=…` seeds the screen and `PUT /loans/{id}` saves it, both through `LoanService`, which owns every loans URL, so this file holds no host, path, query parameter, `dateFormat` or `locale` literal (Rule 2, AAP 0.7.2, AAP 0.14.1, Rule 1 clause 3). */
@Component({
  selector: 'app-loan-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    PanelCardComponent,
    SelectFieldComponent,
  ],
  templateUrl: './loan-edit.component.html',
})
export class LoanEditComponent {
  private readonly loans = inject(LoanService);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly formBuilder = inject(FormBuilder);

  /** Completes the route subscription should the screen be destroyed before it emits. */
  private readonly destroyRef = inject(DestroyRef);

  /** Which load is the current one, incremented by every run of {@link load}. The router reuses this component when the URL moves from one `#/editloanaccount/{id}` to another, so an in-place move starts a second read while the first is still in flight and the superseded run returns instead of writing. */
  private loadSequence = 0;

  /** `true` until the read settles, which is what the template shows while the card fills. */
  readonly loading = signal(true);

  /** `true` when the loan does not exist, or when the body is not a loan at all. */
  readonly notFound = signal(false);

  /** The failure to render above the form, verbatim; `null` while there is none. */
  readonly error = signal<ApiError | null>(null);

  /** The loaded loan, the source of the identifiers the body echoes and of the seeded values. */
  readonly account = signal<LoanAccount | null>(null);

  /** The charges the loan carries, as the edit seed's `charges` member reported them — the rows the save re-posts, and the reason the load keeps that member: `PUT /loans/{id}` treats an absent or empty array as "delete every charge" (AAP 0.7.3, AAP 0.3.4). */
  readonly charges = signal<readonly LoanCharge[] | null>(null);

  /** The template portion of the payload: the persisted enumerations and their option lists. */
  readonly template = signal<LoanEditTemplateFields>(EMPTY_TEMPLATE_FIELDS);

  /** `loanOfficerOptions` of the payload, rendered in its order as the officer picker. */
  readonly loanOfficerOptions = signal<readonly SelectOption[]>([]);

  /** `fundOptions` of the payload, rendered in its order as the fund picker. */
  readonly fundOptions = signal<readonly SelectOption[]>([]);

  /** One request per click: `submit` runs through it and the trigger binds `guard.busy()`. */
  readonly guard = createSubmitGuard();

  /** The edit form, created once so every control reference the template binds is stable. */
  readonly form: FormGroup<LoanEditFormControls>;

  /** The same controls by name, so the template hands single controls to the shared fields. */
  readonly controls: LoanEditFormControls;

  /** The route's `:id`, kept as the raw string so the read, the save and the return link cannot disagree about which loan they address; `null` before the route emits and when it carried none. */
  readonly loanId = signal<string | null>(null);

  /** Creates the form once, so every control reference the template binds is stable, and subscribes to the route's parameters, which is the screen's whole entry point. */
  constructor() {
    this.form = this.formBuilder.group({
      principal: new FormControl<number | null>(null, Validators.required),
      loanTermFrequency: new FormControl<number | null>(null, Validators.required),
      loanTermFrequencyType: new FormControl<SelectValue | null>(null, Validators.required),
      numberOfRepayments: new FormControl<number | null>(null, Validators.required),
      repaymentEvery: new FormControl<number | null>(null, Validators.required),
      repaymentFrequencyType: new FormControl<SelectValue | null>(null, Validators.required),
      interestRatePerPeriod: new FormControl<number | null>(null, Validators.required),
      interestRateFrequencyType: new FormControl<SelectValue | null>(null, Validators.required),
      amortizationType: new FormControl<SelectValue | null>(null, Validators.required),
      interestType: new FormControl<SelectValue | null>(null, Validators.required),
      interestCalculationPeriodType: new FormControl<SelectValue | null>(null, Validators.required),
      transactionProcessingStrategyId: new FormControl<SelectValue | null>(null, Validators.required),
      expectedDisbursementDate: new FormControl<Date | null>(null, Validators.required),
      submittedOnDate: new FormControl<Date | null>(null, Validators.required),
      loanOfficerId: new FormControl<SelectValue | null>(null),
      fundId: new FormControl<SelectValue | null>(null),
    });
    this.controls = this.form.controls;

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.loanId.set(params.get('id'));
        this.reset();
        void this.load();
      });
  }

  /** Saves the edited application with one `PUT /loans/{id}`, then returns to the record (AAP 0.14.2). */
  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    const loanId = this.loanId();

    if (loanId === null) {
      return;
    }

    this.error.set(null);

    try {
      await this.guard.runOnce(async () => {
        await firstValueFrom(this.loans.update(loanId, this.buildRequest()));
        await this.router.navigate(['/viewloanaccount', loanId]);
      });
    } catch (error: unknown) {
      this.error.set(toDisplayableFailure(error));
    }
  }

  /** The body `PUT /loans/{id}` receives: the application field set, built from the controls and the loaded record alone (AAP 0.3.4, Rule 1 clause 2). */
  buildRequest(): LoanApplicationInput {
    const account = this.account();

    if (account === null) {
      throw new Error('The loan edit form has no loaded loan to save.');
    }

    const loanOfficerId = asNumericSelection(this.controls.loanOfficerId.value);
    const fundId = asNumericSelection(this.controls.fundId.value);

    return {
      clientId: account.clientId,
      productId: requireNumber(account.loanProductId ?? null, 'productId'),
      loanType: 'individual',
      principal: requireNumber(this.controls.principal.value, 'principal'),
      loanTermFrequency: requireNumber(this.controls.loanTermFrequency.value, 'loanTermFrequency'),
      loanTermFrequencyType: requireNumber(
        asNumericSelection(this.controls.loanTermFrequencyType.value),
        'loanTermFrequencyType',
      ),
      numberOfRepayments: requireNumber(
        this.controls.numberOfRepayments.value,
        'numberOfRepayments',
      ),
      repaymentEvery: requireNumber(this.controls.repaymentEvery.value, 'repaymentEvery'),
      repaymentFrequencyType: requireNumber(
        asNumericSelection(this.controls.repaymentFrequencyType.value),
        'repaymentFrequencyType',
      ),
      interestRatePerPeriod: requireNumber(
        this.controls.interestRatePerPeriod.value,
        'interestRatePerPeriod',
      ),
      interestRateFrequencyType: requireNumber(
        asNumericSelection(this.controls.interestRateFrequencyType.value),
        'interestRateFrequencyType',
      ),
      amortizationType: requireNumber(
        asNumericSelection(this.controls.amortizationType.value),
        'amortizationType',
      ),
      interestType: requireNumber(
        asNumericSelection(this.controls.interestType.value),
        'interestType',
      ),
      interestCalculationPeriodType: requireNumber(
        asNumericSelection(this.controls.interestCalculationPeriodType.value),
        'interestCalculationPeriodType',
      ),
      transactionProcessingStrategyCode: requireStrategyCode(
        this.controls.transactionProcessingStrategyId.value,
      ),
      expectedDisbursementDate: this.controls.expectedDisbursementDate.value,
      submittedOnDate: this.controls.submittedOnDate.value,
      ...(loanOfficerId === null ? {} : { loanOfficerId }),
      ...(fundId === null ? {} : { fundId }),
      charges: this.chargeRows(),
    };
  }

  /** The save body's `charges` rows: one per charge the loan carries, built from the seed's member. */
  private chargeRows(): LoanChargeRow[] {
    const charges = this.charges();

    if (charges === null) {
      throw new Error('The loan edit form has no loaded charges to save.');
    }

    return charges.map(chargeRow);
  }

  /** Clears everything the previous loan put on the screen, so a route emission for another loan never shows the earlier one's form, identifiers or message. */
  private reset(): void {
    this.account.set(null);
    this.charges.set(null);
    this.template.set(EMPTY_TEMPLATE_FIELDS);
    this.loanOfficerOptions.set([]);
    this.fundOptions.set([]);
    this.error.set(null);
    this.notFound.set(false);
    this.loading.set(true);
    this.form.reset();
  }

  /** Reads the loan and seeds the form from it. One read: the edit seed (`GET /loans/{id}?template=true&associations=…`) carries the loan's own terms, the form's option lists and the loan's `charges`, which the save re-posts (AAP 0.7.3, AAP 0.14.2). */
  private async load(): Promise<void> {
    const load = ++this.loadSequence;
    const loanId = this.loanId();

    if (loanId === null) {
      this.notFound.set(true);
      this.loading.set(false);

      return;
    }

    try {
      const payload = await firstValueFrom(this.loans.getWithTemplate(loanId));

      // The single await is the whole read, so this check covers every write below it: a superseded loan's answer is dropped here rather than seeded under the loan the URL now names.
      if (load !== this.loadSequence) {
        return;
      }

      if (!isLoanAccount(payload)) {
        this.notFound.set(true);

        return;
      }

      const template = readTemplateFields(payload);

      this.account.set(payload);
      this.charges.set(payload.charges ?? []);
      this.template.set(template);
      this.loanOfficerOptions.set(template.loanOfficerOptions);
      this.fundOptions.set(template.fundOptions);
      this.seedForm(payload, template);
    } catch (error: unknown) {
      if (load !== this.loadSequence) {
        return;
      }

      const failure = toDisplayableFailure(error);

      if (failure.status === 404) {
        this.notFound.set(true);
      } else {
        this.error.set(failure);
      }
    } finally {
      // Only the current run owns the loading state: the superseded one must not clear the flag the newer read set, or the card would stop reporting that it is still filling.
      if (load === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  /** Fills the controls from the loaded record: the application amounts and terms, the persisted enumerations, and the two dates from the loan's own timeline. */
  private seedForm(account: LoanAccount, template: LoanEditTemplateFields): void {
    const timeline = account.timeline;

    this.form.patchValue({
      principal: account.principal,
      numberOfRepayments: account.numberOfRepayments,
      repaymentEvery: account.repaymentEvery,
      interestRatePerPeriod: account.interestRatePerPeriod,
      loanTermFrequency: template.termFrequency,
      loanTermFrequencyType: template.termFrequencyType,
      repaymentFrequencyType: template.repaymentFrequencyType,
      interestRateFrequencyType: template.interestRateFrequencyType,
      amortizationType: template.amortizationType,
      interestType: template.interestType,
      interestCalculationPeriodType: template.interestCalculationPeriodType,
      transactionProcessingStrategyId: template.transactionProcessingStrategyCode,
      expectedDisbursementDate: fromFineractDate(timeline?.expectedDisbursementDate),
      submittedOnDate: fromFineractDate(timeline?.submittedOnDate),
      loanOfficerId: template.loanOfficerId,
      fundId: template.fundId,
    });
  }
}
