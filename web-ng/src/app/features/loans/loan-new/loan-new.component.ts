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

import { AppConfigService } from '../../../core/config/app-config.service';
import { screenFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { fromFineractDate } from '../../../shared/date-format.util';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard, type SubmitGuard } from '../../../shared/submit-guard.util';
import type {
  LoanApplicationRequest,
  LoanChargeOption,
  LoanTemplate,
  RepaymentSchedule,
} from '../loan.models';
import { LoanService } from '../loan.service';
import { RepaymentPreviewComponent } from './repayment-preview/repayment-preview.component';

/**
 * The two controls of one charge row of the application's charge list: the charge the applicant
 * picked and the amount the server reports for it.
 *
 * `chargeId` holds the `SelectValue` a `SelectFieldComponent` writes — the charge's own id with its
 * runtime type intact — and `amount` a `number | null`, so a row the applicant has not filled in
 * carries no invented figure. A row is posted only when `chargeId` is set; an untouched row sends
 * nothing at all, which is what keeps `charges` off the body of an application that applies none
 * (AAP 0.7.2, `LoanApplicationRequest.charges`).
 */
interface ChargeRowControls {
  readonly chargeId: FormControl<SelectValue | null>;
  readonly amount: FormControl<number | null>;
}

/**
 * Reads a template payload as the loosely typed record of members the plan does not model.
 *
 * `LoanTemplate` declares the members this application consumes, and the fork sends more beside
 * them: the option list of every enumerated term (`amortizationTypeOptions`,
 * `repaymentFrequencyTypeOptions`, …) and the selected value of several of those enumerations as an
 * object (`{id, code, value}`) rather than as the plain number the model declares. This is the
 * single documented boundary where those extra members are read as `unknown` and narrowed by the
 * guards below; no member of the plan's model is re-declared here and no field of the file is
 * `any` (Rule 1 clause 4). Reading a member the model does declare through this record would lose
 * the model's type for nothing, so every declared member is read off the model directly.
 *
 * @param value A response body the model describes partially.
 * @returns The same object, member by member, as `unknown` values.
 */
function toWire(value: object): Readonly<Record<string, unknown>> {
  return value as unknown as Readonly<Record<string, unknown>>;
}

/**
 * A non-empty string, or `null` for every other value.
 *
 * An empty string counts as absent because Fineract sends `""` for a member it has no value for,
 * and rendering an empty label or posting an empty identifier is not the same as leaving the field
 * empty (Rule 1 clause 3: no value is invented, and none is silently turned into another).
 */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A finite number, or `null`.
 *
 * `NaN` and `Infinity` are excluded: neither is a figure any Fineract payload carries, and letting
 * one into a request body would post a value the applicant never entered.
 */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The identifier of an option or of a selected enumeration value: a finite number or a non-empty
 * string, or `null`.
 *
 * The two types both occur in the payloads this screen reads — every `…Options` list is keyed by a
 * numeric id, while `shared/select-field` keeps whichever type the template sent so the posted body
 * carries the value the server gave (Rule 1 clause 2) — so the reader keeps both and a control
 * holding a string is not coerced to a number.
 */
function asId(value: unknown): SelectValue | null {
  const numeric = asNumber(value);
  if (numeric !== null) {
    return numeric;
  }

  return asText(value);
}

/**
 * The display name of a staff row: `displayName` is what `loanOfficerOptions` carries, while
 * `name` is what every other list carries, and a row that has neither is labelled with the staff
 * member's own first and last name rather than with an empty option (Rule 1 clause 3: the label is
 * the server's text, never a locally invented one).
 */
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

/**
 * One row of an option list, or `null` for an entry that names no id and no label.
 *
 * The rows of the lists this screen renders arrive in three shapes and this reader accepts all
 * three: `{id, name}` for products and funds, `{id, code, value}` for the enumerated term lists, and
 * a staff row carrying `displayName`. The label is the server's text in every case — `value` before
 * `code`, because `value` is the human wording and `code` the message key (AAP 0.4.3, Rule 1
 * clause 3) — and the received order is preserved, since the template's order is the order the
 * legacy screens listed.
 */
function readOptionRow(value: unknown): SelectOption | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = toWire(value);
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

/**
 * The id of a selected enumeration value, which the fork sends either as a plain number or as the
 * `{id, code, value}` object every `…Options` list is built from.
 *
 * Both forms are posted as the number, because that is what `POST /loans` takes for
 * `amortizationType`, `interestType`, `interestCalculationPeriodType`, `loanTermFrequencyType`,
 * `repaymentFrequencyType` and `interestRateFrequencyType` (AAP 0.7.2). A value that names no
 * number yields `null`, and the field then posts nothing rather than a substituted default
 * (Rule 1 clause 3).
 */
function readSelectedId(value: unknown): number | null {
  const direct = asNumber(value);
  if (direct !== null) {
    return direct;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return asNumber(toWire(value)['id']);
}

/**
 * Local midnight of the browser's current date.
 *
 * A form's own default date follows the legacy screen and comes from the browser clock; the
 * tenant's business date is the E2E harness's business and is never read by the application
 * (AAP 0.10.5 item 15, Rule 1 clause 2). Local midnight rather than the current instant, so the day
 * the applicant sees is the day `shared/date-format.util.toFineractDate` writes into the payload.
 */
function today(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The individual loan application screen — `#/newclientloanaccount/:clientId` — which is workflow
 * **W4** (submit an application after previewing its repayment schedule) and the surface workflow
 * **W7** is proved on (a Fineract validation error rendered verbatim) (AAP 0.7.3 "W4 loan
 * application", "W7 validation error"; AAP 0.7.4 loan screens; AAP 0.10.1).
 *
 * **Four calls, all through `LoanService`.** `GET /loans/template?templateType=individual&clientId=`
 * on entry and again with `&productId=` when the product changes, `GET /charges/{id}?template=true`
 * when a charge is picked, `POST /loans?command=calculateLoanSchedule` for the preview and
 * `POST /loans` for the submission (AAP 0.7.3). No URL, path, host, header or query parameter is
 * composed here: `loan.service.ts` owns all of them and the single interceptor owns the auth and
 * tenant headers, so this file holds no endpoint and no host (Rule 1 clause 2 and 5, Rule 2).
 *
 * **One route emission, one application.** `:clientId` is read from `route.paramMap`, never from the
 * snapshot: the router reuses this component when the URL moves from one client's application route to
 * another — the client record links each of its accounts to a form of its own — so a single read would
 * leave the first client's form, options and message on screen under the second client's URL and would
 * issue no request at all. Every emission therefore clears the form, its option lists, the preview and
 * the message, and re-reads the template for the client the URL now names, exactly as `loan-edit`
 * handles the same reuse; an answer that arrives after the URL moved on is discarded rather than
 * painted, and leaving the screen cancels the read it left outstanding.
 *
 * **One builder, two triggers.** `buildRequest()` is the only place the application is assembled and
 * both `preview()` and `submit()` post its result, which is what makes the previewed schedule the
 * schedule of the application actually submitted (AAP 0.7.2, W4). Nothing else reads the form into a
 * payload — no second `FormGroup`, no spread of `form.value` in the template.
 *
 * **Every default and every option comes from the template.** `applyTemplate` seeds the fields from
 * the payload and the pickers from the payload's own lists, in the payload's order. Where the plan's
 * model does not declare a list the fork sends (`amortizationTypeOptions`, `interestTypeOptions`,
 * `interestCalculationPeriodTypeOptions`, `loanTermFrequencyTypeOptions`,
 * `repaymentFrequencyTypeOptions`, `interestRateFrequencyTypeOptions`) it is read through `toWire`
 * and narrowed by the readers above — never replaced by a constant written into this file, because a
 * hard-coded enumeration is a dropdown the legacy screen never showed (Rule 1 clause 3). `principal`
 * and every amount carry `Validators.required` and nothing else: legacy applies no bound, and W7
 * exists to prove Fineract itself rejects a principal above the product maximum (Rule 1 clause 3).
 *
 * **The strategy field is named for the legacy form but carries the code.** The control is
 * `transactionProcessingStrategyId`, the id the legacy template fixes and the E2E page object
 * targets, while its value is the strategy **code**: the fork rejects
 * `transactionProcessingStrategyId` with HTTP 400 ("The parameter transactionProcessingStrategyId is
 * not supported") and accepts `transactionProcessingStrategyCode`, which is the member
 * `LoanApplicationRequest` declares and the one posted (Rule 1 clause 2).
 *
 * **`dateFormat` and `locale` are taken from the configuration, not from the language in view.**
 * `LoanApplicationRequest` requires the pair, so `buildRequest` fills it from `AppConfigService` —
 * the same two values `LoanService` writes at the wire boundary, which overwrites them there with
 * the configured format and the active locale. Reading them from the configuration keeps the preview
 * and the submission identical by construction instead of pairing English month names with whichever
 * language happened to be selected (AAP 0.7.2 "Date handling", Rule 1 clause 2).
 *
 * **`TranslateService` is deliberately not injected.** Every visible string goes through
 * `TranslatePipe`, so a language switch re-renders the screen without a reload and no injected
 * service is left unused. This is the one deviation from the folder's contract, and it changes no
 * dependency direction.
 *
 * **Errors are values.** A 4xx rejection sets `error` to Fineract's own `message`, unaltered and
 * untranslated, and every entered value survives, because W7 compares the message character for
 * character with the server's `defaultUserMessage`; a 5xx or a transport failure sets nothing,
 * because `core/http/fineract.interceptor.ts` has already raised the notification and a second one
 * would double-report (Rule 1 clause 3, AAP 0.7.4). Nothing about the session, the request or the
 * payload is logged (Rule 1 clause 9).
 *
 * **One request per click.** Both triggers are guarded by `createSubmitGuard()`, whose `runOnce`
 * refuses a second entry while a call is in flight, and both are disabled from `guard.busy()`, so
 * one click against a non-idempotent endpoint is one request (AAP 0.1.1, W5).
 */
@Component({
  selector: 'app-loan-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    SelectFieldComponent,
    RepaymentPreviewComponent,
  ],
  templateUrl: './loan-new.component.html',
})
export class LoanNewComponent {
  private readonly loanService = inject(LoanService);

  /**
   * The activated route, subscribed to for the `:clientId` of `#/newclientloanaccount/:clientId`: the
   * router reuses this component across clients, so the segment is followed rather than sampled once.
   */
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  /** Completes the route subscription and the template reads should the screen be destroyed first. */
  private readonly destroyRef = inject(DestroyRef);

  private readonly formBuilder = inject(FormBuilder);

  /** Read only for the `dateFormat` and `locale` pair the request model requires; see the class
   *  comment. It never composes a URL here — that is `LoanService`'s single job. */
  private readonly appConfig = inject(AppConfigService);

  /**
   * The client the application is opened for, exactly as the route carries it: `null` when the URL
   * names no client.
   *
   * A signal, not a snapshot value: the router reuses this component when the URL moves from one
   * client's application to another, so the segment has to follow every emission of `route.paramMap`
   * and every reader of it — the template read, the posted body and the Cancel link.
   */
  readonly clientId = signal<string | null>(null);

  /** The repayment schedule of the last preview, or `null` before one is asked for and after the
   *  product changes. Bound straight to `app-repayment-preview`. */
  readonly schedule = signal<RepaymentSchedule | null>(null);

  /** Fineract's own failure text for the last rejected call, rendered verbatim above the form. */
  readonly error = signal<string | null>(null);

  /** True when the route names no client, so there is nothing to open an application for and no
   *  request is made. The template renders its message in place of the form. */
  readonly notFound = signal(false);

  /** True while a template read is in flight — on entry and after a product change. Consumed by the
   *  card body's `aria-busy` in `loan-new.component.html`, which marks the form busy for assistive
   *  technology while leaving it rendered: legacy shows the form at once and renders no loader
   *  (AAP 0.2.4, Rule 1 clause 3). */
  readonly loading = signal(true);

  /** Keeps one click on either trigger to one request against a non-idempotent endpoint. */
  readonly guard: SubmitGuard = createSubmitGuard();

  /** Products the client may be given, from the template's `productOptions`, in its order. */
  readonly productOptions = signal<readonly SelectOption[]>([]);

  /** Loan officers the application may be assigned to, from the template's `loanOfficerOptions`. */
  readonly loanOfficerOptions = signal<readonly SelectOption[]>([]);

  /** Funds the loan may draw on, from the template's `fundOptions`; empty on a tenant that uses
   *  none, and the field is then simply not offered a value. */
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

  /** Transaction processing strategies, keyed by the `code` the application posts rather than by an
   *  id, because the fork's list is keyed by code (see the class comment). */
  readonly transactionProcessingStrategyOptions = signal<readonly SelectOption[]>([]);

  /**
   * The application form: one control per field of `LoanApplicationRequest`, named as the legacy
   * template names it so the E2E page object resolves each control the same way on both front ends.
   *
   * `principal`, the term, repayment and interest members carry `Validators.required` and nothing
   * more; the dates hold `Date | null`; `loanOfficerId` and `fundId` stay unvalidated because a
   * tenant need not have officers or funds to choose from (Rule 1 clause 3).
   */
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

  /**
   * The charge rows of the form, as the template iterates them: the charges the template preselected
   * plus any the applicant adds through {@link addCharge}.
   *
   * The same `FormArray` as `form.controls.charges`, named separately so the template does not have
   * to spell the path out and so `removeCharge`/`addCharge` and the template cannot address two
   * different arrays.
   */
  readonly chargeRows: FormArray<FormGroup<ChargeRowControls>> = this.form.controls.charges;

  /**
   * Monotonic token of the template reads, so the answer to an earlier read cannot overwrite the
   * fields seeded by a later one.
   *
   * Two quick product selections issue two `GET /loans/template` calls, and so does an in-place move
   * from one client's application route to another; the server may answer them out of order, and only
   * the newest answer is applied. The counter costs nothing and prevents one client's — or one
   * product's — terms from being shown beside another's schedule.
   */
  private templateSequence = 0;

  /**
   * Subscribes to the route's parameters, which is the screen's whole entry point.
   *
   * One subscription, never a `snapshot` read beside it: Angular reuses this component when the URL
   * moves from one `#/newclientloanaccount/{clientId}` to another, and a single read would leave the
   * first client's form, option lists, preview and message on screen for the second client. Each
   * emission therefore resets the screen and re-runs the template read, the way `loan-edit` handles the
   * same reuse.
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        this.applyRoute(params.get('clientId'));
      });
  }

  /**
   * Applies one route emission: stores the segment, clears everything the previous emission put on the
   * screen, and starts the read the new URL needs.
   *
   * A route that names no client issues no request — the screen shows its not-found message instead —
   * so that path takes the next {@link templateSequence} number itself, which is what discards a read
   * the previous emission left outstanding, and clears `loading`, which no read will clear for it.
   *
   * @param clientId the emission's `:clientId` segment, or `null` when it carries none.
   */
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

  /**
   * Clears everything the previous emission put on the screen — the form and its charge rows, every
   * option list the template filled, the preview and the failure — so a route that names another client
   * never shows the earlier client's application.
   *
   * `loading` goes back to `true` until the new read settles, and the not-found outcome of the previous
   * route is dropped: it described the client the URL has left.
   */
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
    this.notFound.set(false);
    this.loading.set(true);
  }

  /**
   * The application as the endpoint takes it: the one body both triggers post.
   *
   * `clientId` comes from the route, every term member from its control, the two dates as `Date`
   * values that `LoanService` formats at the boundary, and `charges` only when at least one row names
   * a charge — an application that applies none sends no `charges` member at all, exactly as the
   * legacy form dropped the empty array (Rule 1 clause 2). `loanOfficerId` and `fundId` are added
   * only when a value is selected: never an empty string and never `0`, which would name an officer
   * or a fund that does not exist.
   *
   * @returns The body for `POST /loans` and for `POST /loans?command=calculateLoanSchedule`.
   * @throws Error when a required field holds no value. Both triggers refuse an invalid form before
   *   they reach here, so this guard keeps the declared shape of the body honest — it never stands in
   *   for validation, and it never posts a figure the applicant did not enter (Rule 1 clause 3).
   */
  buildRequest(): LoanApplicationRequest {
    const values = this.form.getRawValue();
    const config = this.appConfig.config;

    const request: LoanApplicationRequest = {
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
      dateFormat: config.dateFormat,
      locale: config.locale,
    };

    const loanOfficerId = asNumber(values.loanOfficerId);
    if (loanOfficerId !== null) {
      request.loanOfficerId = loanOfficerId;
    }

    const fundId = asNumber(values.fundId);
    if (fundId !== null) {
      request.fundId = fundId;
    }

    const charges = values.charges
      .filter((row) => row.chargeId !== null)
      .map((row) => ({
        chargeId: this.requireNumber(row.chargeId, 'chargeId'),
        amount: this.requireNumber(row.amount, 'amount'),
      }));

    if (charges.length > 0) {
      request.charges = charges;
    }

    return request;
  }

  /**
   * Asks the server to calculate the application's repayment schedule and shows it.
   *
   * The body is `buildRequest()`'s own, so the preview describes the application `submit()` posts.
   * An invalid form is reported in place and sends nothing, which is what the legacy form's own
   * submission did; beyond that no rule is added — neither trigger is disabled on partial validity,
   * because legacy had no such restriction (Rule 1 clause 3).
   */
  preview(): void {
    void this.guard.runOnce(async () => {
      if (!this.isReadyToSend()) {
        return;
      }

      try {
        const schedule = await firstValueFrom(this.loanService.previewSchedule(this.buildRequest()));

        this.schedule.set(schedule);
        this.error.set(null);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  /**
   * Submits the application and opens the loan record it created.
   *
   * The record is addressed by the id the server reports for the new loan — `resourceId`, or the
   * `loanId` the legacy screen navigated with when a fork omits the former — and never by a value
   * this screen derived (Rule 1 clause 2).
   */
  submit(): void {
    void this.guard.runOnce(async () => {
      if (!this.isReadyToSend()) {
        return;
      }

      try {
        const result = await firstValueFrom(this.loanService.create(this.buildRequest()));
        const loanId = result.resourceId ?? asNumber(toWire(result)['loanId']);

        if (loanId === null) {
          return;
        }

        await this.router.navigate(['/viewloanaccount', loanId]);
      } catch (error) {
        this.reportError(error);
      }
    });
  }

  /**
   * Re-reads the template for the newly chosen product and reseeds the whole form from it, which is
   * what the legacy screen did on a product change (AAP 0.3.4 claim 14).
   *
   * The defaults are never copied out of a partial `product` projection: the product-dependent terms
   * the server computed live at the top level of the template, so the whole payload is applied. The
   * previous product's preview is discarded first, because a schedule calculated for another product
   * must not stay on screen beside this one's terms.
   *
   * @param productId The chosen product, when the caller passes it; the control's own value is used
   *   otherwise, so both `(change)="onProductChange()"` and `onProductChange(id)` behave alike.
   */
  onProductChange(productId: SelectValue | null = null): void {
    const clientId = this.clientIdNumber();
    const selected = productId ?? this.form.controls.productId.value;

    if (clientId === null || selected === null) {
      return;
    }

    this.schedule.set(null);
    void this.loadTemplate(clientId, selected);
  }

  /**
   * Reads the picked charge's own terms and puts the amount the server reports into the row.
   *
   * The figure is the server's, never one computed or copied here, because a charge may be a flat
   * amount or a percentage of the principal and only the server knows which (Rule 1 clause 3). A
   * charge whose payload reports no amount leaves the field empty — it is `required`, and Fineract
   * decides what the charge costs.
   *
   * @param rowIndex The charge row that changed.
   * @param chargeId The picked charge, when the caller passes it; the row's own control value is used
   *   otherwise.
   */
  onChargeSelect(rowIndex: number, chargeId: SelectValue | null = null): void {
    if (!this.isChargeRow(rowIndex)) {
      return;
    }

    const row = this.chargeRows.at(rowIndex);
    const selected = chargeId ?? row.controls.chargeId.value;

    // The select writes its own control before this handler runs; writing the value here as well
    // keeps the row coherent for a caller that names the charge directly, so the amount read below
    // always belongs to the charge the body will post.
    if (chargeId !== null && row.controls.chargeId.value !== chargeId) {
      row.controls.chargeId.setValue(chargeId);
    }

    if (selected === null) {
      row.controls.amount.setValue(null);

      return;
    }

    const option = this.chargeOptions().find((charge) => charge.id === selected);
    row.controls.amount.setValue(option?.amount ?? null);
    void this.readChargeAmount(rowIndex, selected);
  }

  /** Adds an empty charge row, which the applicant then fills from the charge list — the application
   *  screen's counterpart of the legacy wizard's "add charge" step. */
  addCharge(): void {
    this.chargeRows.push(this.chargeRow(null, null));
  }

  /**
   * Removes a charge row, so a charge the applicant picked and then thought better of is not posted.
   *
   * @param rowIndex The row to drop; an index outside the array is ignored.
   */
  removeCharge(rowIndex: number): void {
    if (this.isChargeRow(rowIndex)) {
      this.chargeRows.removeAt(rowIndex);
    }
  }

  /**
   * Reads the template and applies it, discarding an answer that a later read has superseded, and
   * cancelling the read if the screen is left before it answers.
   *
   * @param clientId Client the application is opened for.
   * @param productId Product whose defaults are wanted, absent for the first read.
   */
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

  /**
   * Whether a read still speaks for the screen: it is the newest read, and the screen it belongs to has
   * not been destroyed, so a read the route or the teardown cancelled can neither seed the form nor
   * clear the loading state of whatever replaced it.
   *
   * @param sequence the read's {@link templateSequence} number.
   */
  private isCurrent(sequence: number): boolean {
    return !this.destroyRef.destroyed && sequence === this.templateSequence;
  }

  /**
   * Seeds every option list, every default and every charge row from one template payload.
   *
   * The fields are seeded from the template's own values and left empty where the template has none:
   * a product-less template answers its option lists with every default null, and those fields then
   * stay empty for the applicant to fill (AAP 0.7.2, `LoanTemplate`). Only `submittedOnDate` is
   * defaulted here, from the browser clock, because Fineract sends no submission date and the legacy
   * controller set it to `new Date()`; an already-entered date is kept across a product change, as
   * legacy kept it. A new payload also clears the previous preview and error, which describe an
   * application that no longer exists.
   *
   * @param template The payload of `GET /loans/template`.
   */
  private applyTemplate(template: LoanTemplate): void {
    const wire = toWire(template);

    this.productOptions.set(readOptionRows(wire['productOptions']));
    this.loanOfficerOptions.set(readOptionRows(wire['loanOfficerOptions']));
    this.fundOptions.set(readOptionRows(wire['fundOptions']));
    this.termFrequencyTypeOptions.set(readOptionRows(wire['termFrequencyTypeOptions']));
    this.repaymentFrequencyTypeOptions.set(readOptionRows(wire['repaymentFrequencyTypeOptions']));
    this.interestRateFrequencyTypeOptions.set(readOptionRows(wire['interestRateFrequencyTypeOptions']));
    this.amortizationTypeOptions.set(readOptionRows(wire['amortizationTypeOptions']));
    this.interestTypeOptions.set(readOptionRows(wire['interestTypeOptions']));
    this.interestCalculationPeriodTypeOptions.set(
      readOptionRows(wire['interestCalculationPeriodTypeOptions']),
    );
    this.transactionProcessingStrategyOptions.set(
      (template.transactionProcessingStrategyOptions ?? []).map((strategy) => ({
        id: strategy.code,
        name: strategy.name,
      })),
    );

    this.form.patchValue({
      productId: asId(template.product?.id) ?? asId(wire['productId']),
      principal: asNumber(template.principal),
      loanTermFrequency: asNumber(template.termFrequency),
      loanTermFrequencyType: readSelectedId(wire['termPeriodFrequencyType']),
      numberOfRepayments: asNumber(template.numberOfRepayments),
      repaymentEvery: asNumber(template.repaymentEvery),
      repaymentFrequencyType: readSelectedId(wire['repaymentFrequencyType']),
      interestRatePerPeriod: asNumber(template.interestRatePerPeriod),
      interestRateFrequencyType: readSelectedId(wire['interestRateFrequencyType']),
      amortizationType: readSelectedId(wire['amortizationType']),
      interestType: readSelectedId(wire['interestType']),
      interestCalculationPeriodType: readSelectedId(wire['interestCalculationPeriodType']),
      transactionProcessingStrategyId: asText(template.transactionProcessingStrategyCode),
      expectedDisbursementDate: fromFineractDate(template.expectedDisbursementDate),
      submittedOnDate:
        fromFineractDate(template.submittedOnDate) ??
        this.form.controls.submittedOnDate.value ??
        today(),
      loanOfficerId: asId(template.loanOfficerId),
      fundId: asId(template.fundId),
    });

    this.seedCharges(template);
    this.schedule.set(null);
    this.error.set(null);
    this.loading.set(false);
  }

  /**
   * Rebuilds the charge rows from the payload's preselected charges and offers the applicable ones.
   *
   * A charge is offered only if the template lists it, and a preselected one is posted with the amount
   * the template reports for it; an application that applies no charge keeps an empty array and posts
   * no `charges` member at all (Rule 1 clause 2).
   *
   * @param template The payload of `GET /loans/template`.
   */
  private seedCharges(template: LoanTemplate): void {
    this.chargeOptions.set(template.chargeOptions ?? template.charges ?? []);
    this.chargeRows.clear();

    for (const charge of template.charges ?? []) {
      this.chargeRows.push(this.chargeRow(charge.id, asNumber(charge.amount)));
    }
  }

  /**
   * Puts the amount the server reports for one charge into its row.
   *
   * The charge's own template is the authority for the amount — `GET /charges/{id}?template=true`
   * answers with the charge itself, whose `amount` is the figure a flat charge costs (Rule 1
   * clause 2). A row removed while the read was in flight is left alone.
   *
   * @param rowIndex Row the charge was picked in.
   * @param chargeId Charge to read.
   */
  private async readChargeAmount(rowIndex: number, chargeId: SelectValue): Promise<void> {
    try {
      const template = await firstValueFrom(this.loanService.chargeTemplate(chargeId));

      if (!this.isChargeRow(rowIndex)) {
        return;
      }

      // `GET /charges/{id}?template=true` answers with the charge itself, whose declared `amount` is
      // the figure; a payload that answers with the picker shape instead is read from its first row.
      const options: readonly LoanChargeOption[] = template.chargeOptions ?? [];
      const amount = template.amount ?? asNumber(options[0]?.amount) ?? null;

      this.chargeRows.at(rowIndex).controls.amount.setValue(amount);
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Builds one empty or preselected charge row. */
  private chargeRow(chargeId: SelectValue | null, amount: number | null): FormGroup<ChargeRowControls> {
    return this.formBuilder.group<ChargeRowControls>({
      chargeId: this.formBuilder.control<SelectValue | null>(chargeId, Validators.required),
      amount: this.formBuilder.control<number | null>(amount, Validators.required),
    });
  }

  /** Whether an index names a charge row the array still holds. */
  private isChargeRow(rowIndex: number): boolean {
    return rowIndex >= 0 && rowIndex < this.chargeRows.length;
  }

  /**
   * Whether the form may be sent: an invalid form is marked touched, which is what shows each
   * field's error state, and then sends nothing.
   */
  private isReadyToSend(): boolean {
    if (this.form.valid) {
      return true;
    }

    this.form.markAllAsTouched();

    return false;
  }

  /**
   * Shows Fineract's own text for a rejected call, and leaves a 5xx or transport failure alone.
   *
   * A 4xx carries the message the applicant has to act on — W7 compares it character for character
   * with the server's `defaultUserMessage` — so it is rendered exactly as received, with no prefix,
   * no translation and no reformatting, and the entered values stay untouched. A 5xx or a status of
   * 0 has already been turned into a notification by `core/http/fineract.interceptor.ts`; raising a
   * second message here would report one failure twice (AAP 0.7.4, Rule 1 clause 3). A rejection that
   * is not a Fineract answer — the body guard described on {@link buildRequest} refusing to assemble
   * a payload — shows no text either: there is no server message to show, the form keeps every
   * entered value, and nothing is posted.
   *
   * The discriminator is `screenFailure` in `core/http/api-error.ts`, the shared rule every screen in
   * this application applies: it answers the failure for a 4xx and `null` for a 5xx, a transport
   * failure or a fault of this application's own. `error` is set to that answer's message, `null`
   * included, so a message no longer describes the latest failure is cleared rather than left on
   * screen.
   *
   * @param error Whatever the failed call rejected with.
   */
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

  /** A control's value as a number, or the error described on {@link LoanApplicationRequest}. */
  private requireNumber(value: unknown, field: string): number {
    const numeric = asNumber(value);

    if (numeric === null) {
      throw new Error(`loan-new: '${field}' holds no number, so no application body can be built`);
    }

    return numeric;
  }

  /** A control's value as text, or the error described on {@link LoanApplicationRequest}. */
  private requireText(value: unknown, field: string): string {
    const text = asText(value);

    if (text === null) {
      throw new Error(`loan-new: '${field}' holds no value, so no application body can be built`);
    }

    return text;
  }
}
