import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { APP_CONFIG } from '../../../core/config/app-config.token';
import { ApiError } from '../../../core/http/api-error';
import { fromFineractDate } from '../../../shared/date-format.util';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { isLoanAccount } from '../loan.models';
import type { LoanAccount, LoanEditRequest } from '../loan.models';
import { LoanService } from '../loan.service';

/**
 * The sixteen controls of the edit form, in the order the application body carries them.
 *
 * `formControlName` and the rendered element's `id` are the control names themselves, because the
 * parity page objects address the same fields by id on both front ends (`#principal`,
 * `#numberOfRepayments`, `#repaymentEvery`, `#interestRatePerPeriod`, `#expectedDisbursementDate`,
 * `#submittedOnDate`, `#loanOfficerId`, `#fundId`).
 *
 * A select control is `FormControl<SelectValue | null>` because that is the exact input type of
 * `SelectFieldComponent.control`; the chosen id is narrowed to the number the payload carries in
 * {@link LoanEditComponent.buildRequest}, never widened here.
 */
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

/**
 * The template portion of `GET /loans/{id}?template=true&associations=…`, as this screen reads it.
 *
 * `LoanAccount` in `../loan.models` models the loan record and deliberately stops there, while the
 * endpoint also answers the loan form's own members — the persisted term, frequency, amortisation,
 * interest and strategy values and the option lists that let the user change them. They are read
 * here as a documented partial projection of that payload rather than added to the family's model
 * module, which this folder does not own.
 *
 * Every member is `null` or empty when the payload does not carry it, and an empty option list is
 * what makes the template render that field as a static display instead of inventing an
 * enumeration the server never sent (Rule 1 clause 3: dropdown sources are Fineract's own).
 */
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

/**
 * Indexes a response body by member name so the members this file reads through
 * {@link LoanEditTemplateFields} can be narrowed one at a time without a cast.
 *
 * `Object.entries` types a plain object's values as `any`; widening the pairs here keeps every read
 * below a checked `unknown` the narrowing helpers accept, which is the same boundary
 * `loan.service.ts` uses when it serialises a request body.
 */
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

/** The `id` of an enumeration member such as `amortizationType`, or `null` when it is absent. */
function readIdMember(fields: PayloadFields, key: string): number | null {
  const value = fields.get(key);

  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];

  return typeof id === 'number' ? id : null;
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
    termFrequencyType: readIdMember(fields, 'termPeriodFrequencyType'),
    termFrequencyTypeOptions: readIdOptions(fields, 'termFrequencyTypeOptions'),
    repaymentFrequencyType: readIdMember(fields, 'repaymentFrequencyType'),
    repaymentFrequencyTypeOptions: readIdOptions(fields, 'repaymentFrequencyTypeOptions'),
    interestRateFrequencyType: readIdMember(fields, 'interestRateFrequencyType'),
    interestRateFrequencyTypeOptions: readIdOptions(fields, 'interestRateFrequencyTypeOptions'),
    amortizationType: readIdMember(fields, 'amortizationType'),
    amortizationTypeOptions: readIdOptions(fields, 'amortizationTypeOptions'),
    interestType: readIdMember(fields, 'interestType'),
    interestTypeOptions: readIdOptions(fields, 'interestTypeOptions'),
    interestCalculationPeriodType: readIdMember(fields, 'interestCalculationPeriodType'),
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
    loanOfficerId: readIdMember(fields, 'loanOfficerId'),
    loanOfficerOptions: readOfficerOptions(fields, 'loanOfficerOptions'),
    fundId: readIdMember(fields, 'fundId'),
    fundOptions: readIdOptions(fields, 'fundOptions'),
  };
}

/** A select's chosen id as the number the payload posts, or `null` when nothing is chosen. */
function asNumericSelection(value: SelectValue | null): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * A value the body cannot be built without.
 *
 * The form's own `required` validators are what guarantee it is set, because
 * {@link LoanEditComponent.submit} refuses an invalid form before the body is assembled. A missing
 * value therefore reports itself instead of becoming a number or a strategy nobody chose.
 */
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

/**
 * Edit form of an individual loan application: the persisted application, re-read from Fineract and
 * posted back to the endpoint that saves it.
 *
 * **The two calls, and nothing else.**
 * `GET /loans/{id}?template=true&associations=charges,collateral,meeting,multiDisburseDetails` seeds
 * the screen through `LoanService.getWithTemplate`, and `PUT /loans/{id}` saves it through
 * `LoanService.update`. Both live in `loan.service.ts`, which owns every loans URL, so this file
 * holds no host, path, query parameter, `dateFormat` or `locale` literal (Rule 1 clauses 2 and 5;
 * Rule 2). It never imports `HttpClient`, notifies nothing and retries nothing.
 *
 * **Dates.** Every date member stays a `Date | null` in the control and in the body;
 * `LoanService.update` formats it as `dd MMMM yyyy` and writes `dateFormat` together with the active
 * `locale` at the boundary (AAP 0.7.2 "Date handling", AAP 0.14.1). The date the payload held is read
 * back with `fromFineractDate`, never re-derived from the browser clock.
 *
 * **Validation is Fineract's, not this file's.** Each of the fourteen required controls carries
 * `Validators.required` and nothing else — no minimum, no maximum, no pattern, no length limit — so a
 * principal above the product's limit still reaches the server and workflow W7 compares the message
 * Fineract returns (Rule 1 clause 3; AAP 0.7.2). Every value the screen opens with is a value the
 * loaded record carried: no default, rounding or derived figure is introduced here.
 *
 * **Echoed identifiers.** `LoanEditRequest` is the application body unchanged, so `clientId`,
 * `productId` and `loanType: 'individual'` are posted from the loaded record rather than offered as
 * controls: they identify the loan and the edit form never lets them change. `dateFormat` and
 * `locale` are structurally required by that type and are taken from `APP_CONFIG`, the one source of
 * the configured format; `LoanService.update` writes both on the wire from the same configuration and
 * the live locale.
 *
 * **Open item the run settles.** The body posts the application field set the plan fixes. If the
 * fork's `GET /loans/{id}?template=true` payload (or a `PUT` refusal) shows that a member is
 * submit-only, the answer is to hide that member rather than to invent a rule for it. Charges are not
 * part of this form, so the body carries none: the parity run records how the fork treats an absent
 * `charges` array on an edit.
 *
 * **Template fields outside the model.** The endpoint answers the loan form's own members — the
 * persisted term, frequency, amortisation, interest and strategy values plus the option lists that
 * change them — which `LoanAccount` does not declare. They are read through the documented partial
 * projection above and held in {@link template}, the one signal beyond the planned set. No field falls
 * back to a `.form-control-static` display against the fork as it stands, because it sends all seven
 * option lists; a payload that omitted one would render that field as a static value, since this file
 * never invents an enumeration.
 *
 * **States.** A `404`, or a body the `isLoanAccount` guard rejects, replaces the form with the
 * not-found block while the shell stays usable; any other `ApiError` is rendered verbatim above the
 * form with every entered value kept. A `5xx` or a transport failure is already reported once by the
 * interceptor, so this file shows the message and never notifies again.
 */
@Component({
  selector: 'app-loan-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, SelectFieldComponent],
  templateUrl: './loan-edit.component.html',
})
export class LoanEditComponent implements OnInit {
  private readonly loans = inject(LoanService);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly config = inject(APP_CONFIG);

  private readonly formBuilder = inject(FormBuilder);

  /** `true` until the read settles, which is what the template shows while the card fills. */
  readonly loading = signal(true);

  /** `true` when the loan does not exist, or when the body is not a loan at all. */
  readonly notFound = signal(false);

  /** The failure to render above the form, verbatim; `null` while there is none. */
  readonly error = signal<ApiError | null>(null);

  /** The loaded loan, the source of the identifiers the body echoes and of the seeded values. */
  readonly account = signal<LoanAccount | null>(null);

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

  /**
   * The route's `:id`, kept as the raw string so the read, the save and the return link cannot
   * disagree about which loan they address; `null` when the route carried none.
   */
  readonly loanId: string | null;

  constructor() {
    this.loanId = this.route.snapshot.paramMap.get('id');
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
  }

  /** Reads the loan once, with no retry and no polling. */
  ngOnInit(): void {
    void this.load();
  }

  /**
   * Saves the edited application with one `PUT /loans/{id}`, then returns to the record.
   *
   * An invalid form is the legacy screen's own required set and stops here after marking every
   * control touched; nothing else is checked, so a value Fineract must judge is sent to Fineract.
   * A refusal is rendered verbatim above the form with the entered values intact, and a success
   * navigates to `#/viewloanaccount/{id}` through the router (never `window.location`).
   */
  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    const loanId = this.loanId;

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
      if (error instanceof ApiError) {
        this.error.set(error);

        return;
      }

      throw error;
    }
  }

  /**
   * The body `PUT /loans/{id}` receives: the application field set, built from the controls and the
   * loaded record alone.
   *
   * Dates stay `Date | null` (`LoanService.update` serialises them with `dateFormat` and the active
   * locale); the strategy travels as the code the fork accepts rather than an id; and the three
   * identifiers the form does not edit are echoed unchanged from the record. A member the form left
   * empty is posted as absent by the serialiser, so the server's own required-field rule reports it.
   */
  buildRequest(): LoanEditRequest {
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
      dateFormat: this.config.dateFormat,
      locale: this.config.locale,
    };
  }

  /**
   * Reads the loan once and seeds the form from it.
   *
   * A `404` and a body the guard rejects both become the not-found block, which is the only state in
   * which the form is never shown; any other `ApiError` is kept for the error region with the form
   * drawn from whatever loaded. A failure that is not an `ApiError` is rethrown rather than
   * swallowed, and `loading` is cleared on every path.
   */
  private async load(): Promise<void> {
    const loanId = this.loanId;

    if (loanId === null) {
      this.notFound.set(true);
      this.loading.set(false);

      return;
    }

    try {
      const payload = await firstValueFrom(this.loans.getWithTemplate(loanId));

      if (!isLoanAccount(payload)) {
        this.notFound.set(true);

        return;
      }

      const template = readTemplateFields(payload);

      this.account.set(payload);
      this.template.set(template);
      this.loanOfficerOptions.set(template.loanOfficerOptions);
      this.fundOptions.set(template.fundOptions);
      this.seedForm(payload, template);
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        if (error.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(error);
        }
      } else {
        throw error;
      }
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fills the controls from the loaded record: the application amounts and terms, the persisted
   * enumerations, and the two dates from the loan's own timeline.
   */
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
