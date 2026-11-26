import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { screenFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard, type SubmitGuard } from '../../../shared/submit-guard.util';
import { readSelectedId } from '../loan.models';
import type {
  LoanChargeOption,
  LoanTemplate,
  RepaymentSchedule,
} from '../loan.models';
import { LoanService } from '../loan.service';
import type { LoanApplicationInput } from '../loan.service';
import { RepaymentPreviewComponent } from './repayment-preview/repayment-preview.component';

/** The legacy application screen's own `chargeTimeType.id == 2` test for a charge that falls due on a date the applicant supplies, reproduced because `LoanChargeOption.chargeTimeType` models the id and the display text and not the code (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 3). */
const SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID = 2;

/** The three controls of one charge row of the application's charge list: the charge the applicant picked, the amount the server reports for it, and the due date a charge that falls due on a specified date is dated with (AAP 0.7.2 rows `LoanApplicationRequest` and `LoanChargeRequest`). */
interface ChargeRowControls {
  readonly chargeId: FormControl<SelectValue | null>;
  readonly amount: FormControl<number | null>;
  readonly dueDate: FormControl<Date | null>;
}

/** Whether a value is a plain object whose members can be read by key (Rule 1 clause 4, AAP 0.14.1). */
function isWireObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, or `null` for every other value. An empty string counts as absent because Fineract sends `""` for a member it has no value for, and rendering an empty label or posting an empty identifier is not the same as leaving the field empty (Rule 1 clause 3). */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A finite number, or `null`. `NaN` and `Infinity` are excluded: neither is a figure any Fineract payload carries, and letting one into a request body would post a value the applicant never entered. */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The identifier of an option or of a selected enumeration value: a finite number or a non-empty string, or `null` (Rule 1 clause 2). */
function asId(value: unknown): SelectValue | null {
  const numeric = asNumber(value);
  if (numeric !== null) {
    return numeric;
  }

  return asText(value);
}

/** The display name of a staff row: `displayName` is what `loanOfficerOptions` carries, while `name` is what every other list carries, and a row that has neither is labelled with the staff member's own first and last name (Rule 1 clause 3). */
function readRowName(record: Readonly<Record<string, unknown>>): string | null {
  const named = asText(record['name']) ?? asText(record['displayName']);
  if (named !== null) {
    return named;
  }

  const parts = [asText(record['firstname']), asText(record['lastname'])].filter(
    (part): part is string => part !== null,
  );
  const joined = parts.join(' ');

  return joined === '' ? null : joined;
}

/** One row of an option list, or `null` for an entry that names no id and no label (AAP 0.4.3, Rule 1 clause 3). */
function readOptionRow(value: unknown): SelectOption | null {
  if (!isWireObject(value)) {
    return null;
  }

  const record = value;
  const id = asId(record['id']);
  if (id === null) {
    return null;
  }

  const name = readRowName(record) ?? asText(record['value']) ?? asText(record['code']);

  return name === null ? null : { id, name };
}

/** An option list, in the received order, with the rows that name no value left out. */
function readOptionRows(value: unknown): readonly SelectOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: SelectOption[] = [];
  for (const entry of value) {
    const row = readOptionRow(entry);
    if (row !== null) {
      rows.push(row);
    }
  }

  return rows;
}

/** Local midnight of the browser's current date. A form's own default date follows the legacy screen and comes from the browser clock; the tenant's business date is the E2E harness's business and is never read by the application (AAP 0.10.5, Rule 1 clause 2). */
function today(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The individual loan application screen — `#/newclientloanaccount/:clientId` — which is workflow **W4** (submit an application after previewing its repayment schedule) and the surface workflow **W7** is proved on (a Fineract validation error rendered verbatim) (AAP 0.7.3, AAP 0.7.4, AAP 0.10.1, Rule 1 clause 2). */
@Component({
  selector: 'app-loan-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    PanelCardComponent,
    SelectFieldComponent,
    RepaymentPreviewComponent,
    RecordNotFoundComponent,
  ],
  templateUrl: './loan-new.component.html',
})
export class LoanNewComponent {
  private readonly loanService = inject(LoanService);

  /** The activated route, subscribed to for the `:clientId` of `#/newclientloanaccount/:clientId`: the router reuses this component across clients, so the segment is followed rather than sampled once. */
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  /** Completes the route subscription and the template reads should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  private readonly formBuilder = inject(FormBuilder);

  /** The client the application is opened for, exactly as the route carries it: `null` when the URL names no client. */
  readonly clientId = signal<string | null>(null);

  /** The repayment schedule of the last successful preview, or `null` before one is asked for, after the product changes and after a preview the server refuses — the table never outlives the values it was computed for (AAP 0.7.4). */
  readonly schedule = signal<RepaymentSchedule | null>(null);

  /** Fineract's own failure text for the last rejected call, rendered verbatim above the form. */
  readonly error = signal<string | null>(null);

  /** True when the server accepted the application but its answer named no loan id, which leaves the screen with no record to open (AAP 0.14.2). */
  readonly submittedWithoutId = signal(false);

  /** True when the route names no client, so there is nothing to open an application for and no request is made. */
  readonly notFound = signal(false);

  /** True while a template read is in flight — on entry and after a product change (AAP 0.2.4, Rule 1 clause 3). */
  readonly loading = signal(true);

  /** Keeps one click on either trigger to one request against a non-idempotent endpoint. */
  readonly guard: SubmitGuard = createSubmitGuard();

  /** Products the client may be given, from the template's `productOptions`, in its order. */
  readonly productOptions = signal<readonly SelectOption[]>([]);

  /** Loan officers the application may be assigned to, from the template's `loanOfficerOptions`. */
  readonly loanOfficerOptions = signal<readonly SelectOption[]>([]);

  /** Funds the loan may draw on, from the template's `fundOptions`; empty on a tenant that uses none, and the field is then simply not offered a value. */
  readonly fundOptions = signal<readonly SelectOption[]>([]);

  /** Charges applicable to the application, from the template's `chargeOptions`, in its order. */
  readonly chargeOptions = signal<readonly LoanChargeOption[]>([]);

  /** Units `loanTermFrequency` may be counted in, from `termFrequencyTypeOptions`. */
  readonly termFrequencyTypeOptions = signal<readonly SelectOption[]>([]);

  /** Units `repaymentEvery` may be counted in, from `repaymentFrequencyTypeOptions`. */
  readonly repaymentFrequencyTypeOptions = signal<readonly SelectOption[]>([]);

  /** Units `interestRatePerPeriod` may be counted in, from `interestRateFrequencyTypeOptions`. */
  readonly interestRateFrequencyTypeOptions = signal<readonly SelectOption[]>([]);

  /** Amortisation methods, from `amortizationTypeOptions`. */
  readonly amortizationTypeOptions = signal<readonly SelectOption[]>([]);

  /** Interest methods, from `interestTypeOptions`. */
  readonly interestTypeOptions = signal<readonly SelectOption[]>([]);

  /** Interest calculation periods, from `interestCalculationPeriodTypeOptions`. */
  readonly interestCalculationPeriodTypeOptions = signal<readonly SelectOption[]>([]);

  /** Transaction processing strategies, keyed by the `code` the application posts rather than by an id, because the fork's list is keyed by code (see the class comment). */
  readonly transactionProcessingStrategyOptions = signal<readonly SelectOption[]>([]);

  /** The application form: one control per field of `LoanApplicationRequest`, named as the legacy template names it so the E2E page object resolves each control the same way on both front ends (Rule 1 clause 3). */
  readonly form = this.formBuilder.group({
    productId: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    principal: this.formBuilder.control<number | null>(null, Validators.required),
    loanTermFrequency: this.formBuilder.control<number | null>(null, Validators.required),
    loanTermFrequencyType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    numberOfRepayments: this.formBuilder.control<number | null>(null, Validators.required),
    repaymentEvery: this.formBuilder.control<number | null>(null, Validators.required),
    repaymentFrequencyType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    interestRatePerPeriod: this.formBuilder.control<number | null>(null, Validators.required),
    interestRateFrequencyType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    amortizationType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    interestType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    interestCalculationPeriodType: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    transactionProcessingStrategyId: this.formBuilder.control<SelectValue | null>(null, Validators.required),
    expectedDisbursementDate: this.formBuilder.control<Date | null>(null, Validators.required),
    submittedOnDate: this.formBuilder.control<Date | null>(null, Validators.required),
    loanOfficerId: this.formBuilder.control<SelectValue | null>(null),
    fundId: this.formBuilder.control<SelectValue | null>(null),
    charges: this.formBuilder.array<FormGroup<ChargeRowControls>>([]),
  });

  /** The charge rows of the form, as the template iterates them: the charges the template preselected plus any the applicant adds through {@link addCharge}. The same `FormArray` as `form.controls.charges`, named separately. */
  readonly chargeRows: FormArray<FormGroup<ChargeRowControls>> = this.form.controls.charges;

  /** Monotonic token of the template reads, so the answer to an earlier read cannot overwrite the fields seeded by a later one. */
  private templateSequence = 0;

  /** Subscribes to the route's parameters, which is the screen's whole entry point. */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.applyRoute(params.get('clientId'));
      });
  }

  /** Applies one route emission: stores the segment, clears everything the previous emission put on the screen, and starts the read the new URL needs. */
  private applyRoute(clientId: string | null): void {
    this.clientId.set(clientId);
    this.reset();

    const parsed = this.clientIdNumber();

    if (parsed === null) {
      this.templateSequence += 1;
      this.notFound.set(true);
      this.loading.set(false);

      return;
    }

    this.notFound.set(false);
    void this.loadTemplate(parsed);
  }

  /** Clears everything the previous emission put on the screen — the form and its charge rows, every option list the template filled, the preview and the failure — so a route that names another client never shows the earlier client's application. */
  private reset(): void {
    this.form.reset();
    this.chargeRows.clear();
    this.productOptions.set([]);
    this.loanOfficerOptions.set([]);
    this.fundOptions.set([]);
    this.chargeOptions.set([]);
    this.termFrequencyTypeOptions.set([]);
    this.repaymentFrequencyTypeOptions.set([]);
    this.interestRateFrequencyTypeOptions.set([]);
    this.amortizationTypeOptions.set([]);
    this.interestTypeOptions.set([]);
    this.interestCalculationPeriodTypeOptions.set([]);
    this.transactionProcessingStrategyOptions.set([]);
    this.schedule.set(null);
    this.error.set(null);
    this.submittedWithoutId.set(false);
    this.notFound.set(false);
    this.loading.set(true);
  }

  /** The application as the endpoint takes it: the one body both triggers post (Rule 1 clause 2, Rule 1 clause 3). */
  buildRequest(): LoanApplicationInput {
    const values = this.form.getRawValue();

    const request: LoanApplicationInput = {
      clientId: this.requireNumber(this.clientIdNumber(), 'clientId'),
      productId: this.requireNumber(values.productId, 'productId'),
      loanType: 'individual',
      principal: this.requireNumber(values.principal, 'principal'),
      loanTermFrequency: this.requireNumber(values.loanTermFrequency, 'loanTermFrequency'),
      loanTermFrequencyType: this.requireNumber(values.loanTermFrequencyType, 'loanTermFrequencyType'),
      numberOfRepayments: this.requireNumber(values.numberOfRepayments, 'numberOfRepayments'),
      repaymentEvery: this.requireNumber(values.repaymentEvery, 'repaymentEvery'),
      repaymentFrequencyType: this.requireNumber(values.repaymentFrequencyType, 'repaymentFrequencyType'),
      interestRatePerPeriod: this.requireNumber(values.interestRatePerPeriod, 'interestRatePerPeriod'),
      interestRateFrequencyType: this.requireNumber(values.interestRateFrequencyType, 'interestRateFrequencyType'),
      amortizationType: this.requireNumber(values.amortizationType, 'amortizationType'),
      interestType: this.requireNumber(values.interestType, 'interestType'),
      interestCalculationPeriodType: this.requireNumber(
        values.interestCalculationPeriodType,
        'interestCalculationPeriodType',
      ),
      transactionProcessingStrategyCode: this.requireText(
        values.transactionProcessingStrategyId,
        'transactionProcessingStrategyId',
      ),
      expectedDisbursementDate: values.expectedDisbursementDate,
      submittedOnDate: values.submittedOnDate,
    };

    const loanOfficerId = asNumber(values.loanOfficerId);
    if (loanOfficerId !== null) {
      request.loanOfficerId = loanOfficerId;
    }

    const fundId = asNumber(values.fundId);
    if (fundId !== null) {
      request.fundId = fundId;
    }

    // A row posts its due date only when it holds one, which only a charge that falls due on a specified date ever reveals: a charge dated on disbursement carries no `dueDate` member at all (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 2).
    const charges = values.charges
      .filter((row) => row.chargeId !== null)
      .map((row) => ({
        chargeId: this.requireNumber(row.chargeId, 'chargeId'),
        amount: this.requireNumber(row.amount, 'amount'),
        ...(row.dueDate === null ? {} : { dueDate: row.dueDate }),
      }));

    if (charges.length > 0) {
      request.charges = charges;
    }

    return request;
  }

  /** Asks the server to calculate the application's repayment schedule and shows it (Rule 1 clause 3). */
  preview(): void {
    void this.guard.runOnce(async () => {
      if (!this.isReadyToSend()) {
        return;
      }

      // The table must belong to the values the form holds when the answer arrives, so the schedule of any earlier preview is dropped before this one is asked for: a calculation the server refuses then leaves no table on screen instead of one an earlier principal produced (AAP 0.7.4).
      this.schedule.set(null);

      try {
        const schedule = await firstValueFrom(this.loanService.previewSchedule(this.buildRequest()));

        this.schedule.set(schedule);
        this.error.set(null);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  /** Submits the application and opens the loan record it created (Rule 1 clause 2, AAP 0.14.2). */
  submit(): void {
    void this.guard.runOnce(async () => {
      this.submittedWithoutId.set(false);

      if (!this.isReadyToSend()) {
        return;
      }

      try {
        const result = await firstValueFrom(this.loanService.create(this.buildRequest()));
        const loanId = result.resourceId ?? result.loanId ?? null;

        if (loanId === null) {
          this.submittedWithoutId.set(true);

          return;
        }

        await this.router.navigate(['/viewloanaccount', loanId]);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  /** Re-reads the template for the newly chosen product and reseeds the whole form from it, which is what the legacy screen did on a product change (AAP 0.3.4 claim 14). */
  onProductChange(productId: SelectValue | null = null): void {
    const clientId = this.clientIdNumber();
    const selected = productId ?? this.form.controls.productId.value;

    if (clientId === null || selected === null) {
      return;
    }

    this.schedule.set(null);
    void this.loadTemplate(clientId, selected);
  }

  /** Reads the picked charge's own terms, puts the amount the server reports into the row, and keeps a due date only on the row of a charge that falls due on a specified date (Rule 1 clause 3). */
  onChargeSelect(rowIndex: number, chargeId: SelectValue | null = null): void {
    if (!this.isChargeRow(rowIndex)) {
      return;
    }

    const row = this.chargeRows.at(rowIndex);
    const selected = chargeId ?? row.controls.chargeId.value;

    if (chargeId !== null && row.controls.chargeId.value !== chargeId) {
      row.controls.chargeId.setValue(chargeId);
    }

    if (selected === null) {
      row.controls.amount.setValue(null);
      row.controls.dueDate.setValue(null);

      return;
    }

    const option = this.chargeOptions().find((charge) => charge.id === selected);
    row.controls.amount.setValue(option?.amount ?? null);

    // A due date belongs to the charge that falls due on a specified date and to no other, so a row that no longer holds such a charge drops the date it carried rather than posting one charge's date for another (AAP 0.7.2 row `LoanChargeRequest`).
    if (option?.chargeTimeType?.id !== SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID) {
      row.controls.dueDate.setValue(null);
    }

    void this.readChargeAmount(rowIndex, selected);
  }

  /** Whether a charge row's picked charge falls due on a date the applicant supplies — the legacy `chargeTimeType.id == 2` test, which reveals the row's due-date field and is what {@link buildRequest} posts `dueDate` for (AAP 0.7.2 row `LoanChargeRequest`; Rule 1 clause 3). */
  isSpecifiedDueDate(row: FormGroup<ChargeRowControls>): boolean {
    const selected = row.controls.chargeId.value;

    if (selected === null) {
      return false;
    }

    const option = this.chargeOptions().find((charge) => charge.id === selected);

    return option?.chargeTimeType?.id === SPECIFIED_DUE_DATE_CHARGE_TIME_TYPE_ID;
  }

  /** Adds an empty charge row, which the applicant then fills from the charge list — the application screen's counterpart of the legacy wizard's "add charge" step. */
  addCharge(): void {
    this.chargeRows.push(this.chargeRow(null, null));
  }

  /** Removes a charge row, so a charge the applicant picked and then thought better of is not posted. @param rowIndex The row to drop; an index outside the array is ignored. */
  removeCharge(rowIndex: number): void {
    if (this.isChargeRow(rowIndex)) {
      this.chargeRows.removeAt(rowIndex);
    }
  }

  /** Reads the template and applies it, discarding an answer that a later read has superseded, and cancelling the read if the screen is left before it answers. @param clientId Client the application is opened for. @param productId Product whose defaults are wanted, absent for the first read. */
  private async loadTemplate(clientId: number, productId?: SelectValue): Promise<void> {
    const sequence = ++this.templateSequence;
    this.loading.set(true);

    try {
      const template = await firstValueFrom(
        this.loanService
          .template(clientId, productId ?? undefined)
          .pipe(takeUntilDestroyed(this.destroyRef)),
      );

      if (!this.isCurrent(sequence)) {
        return;
      }

      this.applyTemplate(template);
    } catch (error) {
      if (!this.isCurrent(sequence)) {
        return;
      }

      this.reportError(error);
      this.loading.set(false);
    }
  }

  /** Whether a read still speaks for the screen: it is the newest read, and the screen it belongs to has not been destroyed, so a read the route or the teardown cancelled can neither seed the form nor clear the loading state. */
  private isCurrent(sequence: number): boolean {
    return !this.destroyRef.destroyed && sequence === this.templateSequence;
  }

  /** Seeds every option list, every default and every charge row from one template payload (AAP 0.7.2). Every member is read from the typed `LoanTemplate` this service returns, so a Fineract rename fails the build; the row helpers below still drop any row the server sent in another shape, and a list the payload omitted simply leaves its picker empty. */
  private applyTemplate(template: LoanTemplate): void {
    this.productOptions.set(readOptionRows(template.productOptions));
    this.loanOfficerOptions.set(readOptionRows(template.loanOfficerOptions));
    this.fundOptions.set(readOptionRows(template.fundOptions));
    this.termFrequencyTypeOptions.set(readOptionRows(template.termFrequencyTypeOptions));
    this.repaymentFrequencyTypeOptions.set(readOptionRows(template.repaymentFrequencyTypeOptions));
    this.interestRateFrequencyTypeOptions.set(
      readOptionRows(template.interestRateFrequencyTypeOptions),
    );
    this.amortizationTypeOptions.set(readOptionRows(template.amortizationTypeOptions));
    this.interestTypeOptions.set(readOptionRows(template.interestTypeOptions));
    this.interestCalculationPeriodTypeOptions.set(
      readOptionRows(template.interestCalculationPeriodTypeOptions),
    );
    this.transactionProcessingStrategyOptions.set(
      (template.transactionProcessingStrategyOptions ?? []).map((strategy) => ({
        id: strategy.code,
        name: strategy.name,
      })),
    );

    this.form.patchValue({
      productId: asId(template.product?.id) ?? asId(template.productId),
      principal: asNumber(template.principal),
      loanTermFrequency: asNumber(template.termFrequency),
      loanTermFrequencyType: readSelectedId(template.termPeriodFrequencyType),
      numberOfRepayments: asNumber(template.numberOfRepayments),
      repaymentEvery: asNumber(template.repaymentEvery),
      repaymentFrequencyType: readSelectedId(template.repaymentFrequencyType),
      interestRatePerPeriod: asNumber(template.interestRatePerPeriod),
      interestRateFrequencyType: readSelectedId(template.interestRateFrequencyType),
      amortizationType: readSelectedId(template.amortizationType),
      interestType: readSelectedId(template.interestType),
      interestCalculationPeriodType: readSelectedId(template.interestCalculationPeriodType),
      transactionProcessingStrategyId: asText(template.transactionProcessingStrategyCode),
      // Both default dates come from the browser clock and from nothing else: AAP 0.10.5 item 15 keeps a form's default dates (submission and disbursement among them) on the clock legacy used, and AAP 0.12 leaves the tenant's business date to the harness, which is where the business date the contract asks for is discharged. Reading either member from the template would put the pair on two clocks; reading the business date here would add a request legacy never makes.
      expectedDisbursementDate: this.form.controls.expectedDisbursementDate.value ?? today(),
      submittedOnDate: this.form.controls.submittedOnDate.value ?? today(),
      loanOfficerId: asId(template.loanOfficerId),
      fundId: asId(template.fundId),
    });

    this.seedCharges(template);
    this.schedule.set(null);
    this.error.set(null);
    this.loading.set(false);
  }

  /** Rebuilds the charge rows from the payload's preselected charges and offers the applicable ones (Rule 1 clause 2). */
  private seedCharges(template: LoanTemplate): void {
    this.chargeOptions.set(template.chargeOptions ?? template.charges ?? []);
    this.chargeRows.clear();

    for (const charge of template.charges ?? []) {
      this.chargeRows.push(this.chargeRow(charge.id, asNumber(charge.amount)));
    }
  }

  /** Puts the amount the server reports for one charge into its row (Rule 1 clause 2). */
  private async readChargeAmount(rowIndex: number, chargeId: SelectValue): Promise<void> {
    try {
      const template = await firstValueFrom(this.loanService.chargeTemplate(chargeId));

      if (!this.isChargeRow(rowIndex)) {
        return;
      }

      // `GET /charges/{id}?template=true` answers with the charge itself, whose declared `amount` is the figure; a payload that answers with the picker shape instead is read from its first row.
      const options: readonly LoanChargeOption[] = template.chargeOptions ?? [];
      const amount = template.amount ?? asNumber(options[0]?.amount) ?? null;

      this.chargeRows.at(rowIndex).controls.amount.setValue(amount);
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Builds one empty or preselected charge row. Its due date starts empty on every row, because only a charge that falls due on a specified date reveals the field and the applicant supplies the date (AAP 0.7.2 row `LoanChargeRequest`). */
  private chargeRow(chargeId: SelectValue | null, amount: number | null): FormGroup<ChargeRowControls> {
    return this.formBuilder.group<ChargeRowControls>({
      chargeId: this.formBuilder.control<SelectValue | null>(chargeId, Validators.required),
      amount: this.formBuilder.control<number | null>(amount, Validators.required),
      dueDate: this.formBuilder.control<Date | null>(null),
    });
  }

  /** Whether an index names a charge row the array still holds. */
  private isChargeRow(rowIndex: number): boolean {
    return rowIndex >= 0 && rowIndex < this.chargeRows.length;
  }

  /** Whether the form may be sent: an invalid form is marked touched, which is what shows each field's error state, and then sends nothing. */
  private isReadyToSend(): boolean {
    if (this.form.valid) {
      return true;
    }

    this.form.markAllAsTouched();

    return false;
  }

  /** Shows Fineract's own text for a rejected call, and leaves a 5xx or transport failure alone (AAP 0.7.4, Rule 1 clause 3). */
  private reportError(error: unknown): void {
    this.error.set(screenFailure(error)?.message ?? null);
  }

  /** The route's client id as a number, or `null` when the route carries none or a non-numeric one. */
  private clientIdNumber(): number | null {
    const clientId = this.clientId();

    if (clientId === null) {
      return null;
    }

    const parsed = Number(clientId);

    return Number.isInteger(parsed) ? parsed : null;
  }

  /** A control's value as a number, or the error described on {@link LoanApplicationInput}. */
  private requireNumber(value: unknown, field: string): number {
    const numeric = asNumber(value);

    if (numeric === null) {
      throw new Error(`loan-new: '${field}' holds no number, so no application body can be built`);
    }

    return numeric;
  }

  /** A control's value as text, or the error described on {@link LoanApplicationInput}. */
  private requireText(value: unknown, field: string): string {
    const text = asText(value);

    if (text === null) {
      throw new Error(`loan-new: '${field}' holds no value, so no application body can be built`);
    }

    return text;
  }
}
