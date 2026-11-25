import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type {
  LoanActionRequest,
  LoanActionTemplate,
  LoanCommand,
  LoanTransactionTemplate,
} from '../loan.models';
import { LoanRepaymentComponent } from '../loan-repayment/loan-repayment.component';
import { LoanService } from '../loan.service';

/**
 * What the route's `:action` segment selects: one of the five lifecycle commands, the repayment
 * form, or — for every other segment, including a missing one — the not-found outcome.
 *
 * `'notfound'` is a resolved mode rather than an error, for the reason
 * `loan-charge-form.component.ts` gives for the same resolution: a screen the application does not
 * serve issues no request and renders the not-found message instead (AAP 0.7.4 state rules;
 * AAP 0.9.2).
 */
type LoanActionMode = LoanCommand | 'repayment' | 'notfound';

/** The six modes that name a real screen, i.e. every mode but the not-found outcome. */
type ServedMode = Exclude<LoanActionMode, 'notfound'>;

/**
 * The six route segments this screen serves, as a lookup the segment is validated against.
 *
 * `satisfies Record<ServedMode, true>` makes a mode missing from this table — or one the type no
 * longer holds — a compile error, so {@link isServedMode} cannot drift from the union it narrows.
 * The segments are spelled exactly as `loans.routes.ts` and `tools/parity/in-scope-routes.json`
 * fix them: lowercase and unseparated, because they are the legacy URL's own words.
 */
const SERVED_MODES = {
  approve: true,
  undoapproval: true,
  reject: true,
  disburse: true,
  undodisbursal: true,
  repayment: true,
} satisfies Record<ServedMode, true>;

/**
 * Whether a raw `:action` segment names a screen this application serves.
 *
 * `Object.hasOwn` rather than `in`, so a segment such as `toString` or `constructor` is refused
 * instead of passing on an inherited member of the object's prototype.
 *
 * @param value the `:action` segment exactly as the route delivered it.
 * @returns true when the segment names one of the six served modes.
 */
function isServedMode(value: string): value is ServedMode {
  return Object.hasOwn(SERVED_MODES, value);
}

/**
 * The mode a route segment selects, with the not-found outcome for anything unrecognised.
 *
 * A `null` segment — the route matched without an `:action` — and a word this application does not
 * serve both resolve to `'notfound'`; there is no fallback mode and no redirect (AAP 0.7.4).
 *
 * @param segment the `:action` segment as the route delivered it, or `null` when it carried none.
 * @returns the mode to render.
 */
function resolveMode(segment: string | null): LoanActionMode {
  return segment === null || !isServedMode(segment) ? 'notfound' : segment;
}

/**
 * The lifecycle command each served mode posts, or `null` for the repayment form.
 *
 * The repayment screen is a different endpoint family (`POST /loans/{id}/transactions`) owned by
 * `LoanRepaymentComponent`, so this table is also the statement that this component posts nothing in
 * that mode: `null` here is what stops {@link LoanActionComponent.submit} before any request.
 */
const COMMAND_BY_MODE = {
  approve: 'approve',
  undoapproval: 'undoapproval',
  reject: 'reject',
  disburse: 'disburse',
  undodisbursal: 'undodisbursal',
  repayment: null,
} satisfies Record<ServedMode, LoanCommand | null>;

/**
 * The copy one lifecycle command renders, as translation keys of the shipped legacy bundles rather
 * than sentences (AAP 0.10.2). `FineractMissingTranslationHandler` stands behind a key a bundle
 * lacks, so no raw dotted key can reach the user.
 */
interface LoanActionCopy {
  /** Heading of the screen: the command's own legacy heading key. */
  readonly headingKey: string;

  /** Label of the primary button, which submits the command. */
  readonly submitKey: string;
}

/**
 * The five commands' copy, keyed by the command itself.
 *
 * `satisfies Record<LoanCommand, LoanActionCopy>` is the point of the declaration: a command added
 * to the union without copy, or copy left behind by a command removed from it, is a compile error,
 * so the template reads the current command's labels through an exhaustive lookup and no `default:`
 * branch can quietly render another action's wording. Every key here is corrected in this one place
 * if the parity run finds the legacy bundles spell one differently.
 *
 * The keys are the legacy `label.heading.*` / `label.button.*` families in the command's own
 * vocabulary — the route segment and the command are the same word, so a heading cannot disagree
 * with the action it heads.
 */
const ACTION_COPY = {
  approve: { headingKey: 'label.heading.approve', submitKey: 'label.button.approve' },
  undoapproval: { headingKey: 'label.heading.undoapproval', submitKey: 'label.button.undoapproval' },
  reject: { headingKey: 'label.heading.reject', submitKey: 'label.button.reject' },
  disburse: { headingKey: 'label.heading.disburse', submitKey: 'label.button.disburse' },
  undodisbursal: { headingKey: 'label.heading.undodisbursal', submitKey: 'label.button.undodisbursal' },
} satisfies Record<LoanCommand, LoanActionCopy>;

/**
 * The approve body's own fields, taken from the model's `approve` arm.
 *
 * `Pick` keeps `../loan.models` the source of truth for every member's wire name and type, while
 * leaving out the two members `LoanService.action` writes itself from the resolved configuration as
 * it serialises the request. A screen that held those two would keep a second copy of the payload's
 * date contract (Rule 1 clause 2; AAP 0.14.1), so the body assembled here carries the command's own
 * fields and {@link LoanActionComponent.send} is the one place it meets the model.
 */
type ApproveFields = Pick<
  Extract<LoanActionRequest, { command: 'approve' }>,
  'command' | 'approvedOnDate' | 'approvedLoanAmount' | 'note'
>;

/** The reject body's own fields, taken from the model's `reject` arm for the reason {@link ApproveFields} gives. */
type RejectFields = Pick<
  Extract<LoanActionRequest, { command: 'reject' }>,
  'command' | 'rejectedOnDate' | 'note'
>;

/** The disburse body's own fields, taken from the model's `disburse` arm for the reason {@link ApproveFields} gives. */
type DisburseFields = Pick<
  Extract<LoanActionRequest, { command: 'disburse' }>,
  'command' | 'actualDisbursementDate' | 'transactionAmount' | 'note'
>;

/**
 * The undo-approval body: the model's own arm, whose single member is the optional note.
 *
 * It is taken whole rather than picked, because the command takes nothing this screen does not send.
 */
type UndoApprovalFields = Extract<LoanActionRequest, { command: 'undoapproval' }>;

/** The undo-disbursal body: the model's own arm, which declares no member at all. */
type UndoDisbursalFields = Extract<LoanActionRequest, { command: 'undodisbursal' }>;

/**
 * Every body this screen can assemble, as a union of the five commands' shapes.
 *
 * {@link LoanActionComponent.assembleFields} answers one arm of it per command, so the union is what
 * makes a missing arm a compile error, and {@link LoanActionComponent.buildRequest} reconciles the
 * whole union with the model in one place.
 */
type LoanActionFields =
  | ApproveFields
  | RejectFields
  | DisburseFields
  | UndoApprovalFields
  | UndoDisbursalFields;

/**
 * The text shown when a call rejects with something the interceptor did not map to an `ApiError`.
 *
 * Every Fineract answer reaches a screen as `ApiError`, whose `message` is the server's own
 * `defaultUserMessage` rendered verbatim (AAP 0.4.2, AAP 0.4.4 decision 6). A rejection of another
 * shape is a fault in this application rather than an answer from Fineract, so it has no server text
 * to show; this fixed sentence keeps the form from displaying nothing at all, and it is deliberately
 * not translated, because no language bundle carries wording for a fault the server never reported.
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
 * The single-purpose loan lifecycle action screen — workflow W5 of the Agent Action Plan, mounted at
 * `#/loanaccount/:id/:action` by `loans.routes.ts` under the `UPDATE_LOAN` permission (AAP 0.7.1
 * Features row `loans`; AAP 0.7.4 "the action screens … are single-purpose forms rendered in the same
 * card, each with a primary submit and a cancel that returns to the record"; AAP 0.8.2).
 *
 * **One route, six screens.** The `:action` segment decides which of them renders, and no seventh
 * loan route exists for any action (AAP 0.10.4 `in-scope-routes.json`): `approve`, `undoapproval`,
 * `reject`, `disburse` and `undodisbursal` are the five lifecycle commands, and `repayment` mounts
 * `LoanRepaymentComponent`, which owns workflow W6. Anything else — an unknown word, a segment the
 * router did not deliver — is the not-found outcome, which renders its message in place of the form
 * and issues no request at all (AAP 0.7.4 state rules).
 *
 * **What it calls, and through what** (AAP 0.7.3 row "W5 approve and disburse"):
 *
 * - `approve` and `reject` — `GET /loans/{id}/template?templateType=approval` through
 *   {@link LoanService.approvalTemplate}, the form's seed;
 * - `disburse` — `GET /loans/{id}/transactions/template?command=disburse` through
 *   {@link LoanService.actionTemplate}, the same command's own seed;
 * - `undoapproval` and `undodisbursal` — no template call: the two confirm views have no fields to
 *   seed;
 * - `repayment` — no call from this component: the child loads its own template and schedule;
 * - `POST /loans/{id}?command=<command>` through {@link LoanService.action}, once per click.
 *
 * This file holds no URL, no query parameter name, no host and no HTTP client: the service composes
 * the whole request and `core/http/fineract.interceptor.ts` attaches `Authorization` and
 * `Fineract-Platform-TenantId` (Rule 1 clause 5, Rule 2; AAP 0.4.2, AAP 0.14.1).
 *
 * **Dates.** Every date control holds a `Date | null`; this component formats none of them and adds
 * neither member of the payload's date contract, because `LoanService.action` serialises each date
 * and writes those members from the resolved configuration as the body leaves (AAP 0.7.2 "Date
 * handling"; Rule 1 clause 2). A date field therefore starts **empty and required** and Fineract
 * decides. That is a registered deviation from AAP 0.10.5 item 15, which permits a form's own
 * browser-clock default: seeding a field from the template's date would mean reading Fineract's wire
 * date shape, whose single reader is `web-ng/src/app/shared/date-format.util.ts` and which is not a
 * dependency of this file, so the field takes no default rather than an invented one. The figures are
 * seeded where the template sends them — `approvalAmount` for the approved principal, `amount` for
 * the disbursed amount — and are never hard-coded, rounded or bounded.
 *
 * **What it does not improve.** Defaults and option lists come from the template endpoints;
 * `Validators.required` is the only validator and only on the fields the three dated commands need,
 * so nothing is blocked by a rule Fineract does not state (AAP 0.4.4 decision 6, Rule 1 clause 3);
 * `ApiError.message` is rendered verbatim above the form, which keeps every entered value, and no
 * notification is raised here because the interceptor already shows one for a 5xx or network failure
 * (AAP 0.7.4). There is no confirmation step, no success toast and no amount check.
 *
 * **One request per click.** The POST goes through `guard.runOnce`, so a second click while the first
 * is in flight sends nothing: Fineract's action endpoints are not idempotent (AAP 0.1.1, AAP 0.14.1;
 * `shared/submit-guard.util.ts`). The trigger's disabled state is the template's `guard.busy()`.
 *
 * **Two deliberate departures, both recorded.**
 *
 * 1. `web-ng/src/app/shared/select-field/select-field.component.ts` is **not** imported and no
 *    payment-type picker is rendered. `LoanTransactionTemplate` in `../loan.models` does expose
 *    `paymentTypeOptions`, but `LoanActionRequest`'s `disburse` arm carries no payment-type member, so
 *    a picker would collect a choice the body has no field for. Adding that field would widen the wire
 *    contract this screen does not own and add a control the legacy disburse screen's body does not
 *    carry (Rule 1 clauses 2 and 3).
 * 2. The not-found branch renders `label.heading.notavailable` and `error.msg.resource.not.found` —
 *    the keys `features/not-found/not-found.component.html` and
 *    `features/clients/client-actions/client-actions.component.ts` actually resolve — rather than a
 *    second not-found string of this screen's own.
 *
 * **Presentation.** No stylesheet, no inline style and no colour: the panel, the labels, the controls,
 * the invalid state and the error block are Bootstrap 3 and the legacy partials compiled into
 * `web-ng/src/styles.scss` (Rule 1 clause 6). The native date control replaces the legacy jQuery
 * datepicker (AAP 0.10.5 item 1). Nothing is logged: not the loan id, not a body, not a credential
 * (Rule 1 clause 9).
 */
@Component({
  selector: 'app-loan-action',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    EmptyStateComponent,
    LoanRepaymentComponent,
  ],
  templateUrl: './loan-action.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanActionComponent {
  /** The loans family's typed HTTP service: the only collaborator this screen calls Fineract through. */
  private readonly loans = inject(LoanService);

  /** The route whose `:id` and `:action` segments name the loan and the action. */
  private readonly route = inject(ActivatedRoute);

  /** Navigation back to the record after a command lands; never `window.location`. */
  private readonly router = inject(Router);

  /**
   * Id of the loan the action applies to, as the `:id` segment delivered it.
   *
   * Kept as the raw string segment rather than parsed with `Number()`: every `LoanService` method
   * accepts `number | string`, a route parameter arrives as text, and the id is spelled in the
   * request path and in the return navigation exactly as the route held it. Empty until the route
   * resolved, which is also what keeps a not-found screen from carrying an id to post against.
   */
  readonly id = signal<number | string>('');

  /** The screen the `:action` segment selected, `'notfound'` until resolved and for an unknown segment. */
  readonly mode = signal<LoanActionMode>('notfound');

  /**
   * The lifecycle command being posted, or `null` for the repayment and not-found modes.
   *
   * {@link COMMAND_BY_MODE} is the only producer of this value, so the command and the mode it was
   * resolved from cannot disagree, and a `null` here is what stops {@link submit} before any request.
   */
  readonly command = signal<LoanCommand | null>(null);

  /** Whether the mode's seed read is in flight, so the template withholds the form until it settles. */
  readonly loading = signal(false);

  /** The failure the template renders above the form, or `null` while the last call succeeded. */
  readonly error = signal<ApiError | null>(null);

  /**
   * Whether the screen must render the not-found message: an unknown `:action`, a route without its
   * `:id`, or a `404` from the mode's seed read (the id is not a loan, or not a loan in this state).
   *
   * Held apart from `error` because the template renders it in place of the form, where a Fineract
   * validation failure is rendered above a form the user keeps editing (AAP 0.7.4).
   */
  readonly notFound = signal(false);

  /**
   * The heading key of the current command, or `''` for the repayment and not-found modes.
   *
   * Read through {@link ACTION_COPY}, so the heading and the button below cannot name different
   * commands, and `''` is what keeps the template from rendering an action heading over the child
   * component or the not-found message.
   */
  readonly headingKey = computed<string>(() => {
    const command = this.command();

    return command === null ? '' : ACTION_COPY[command].headingKey;
  });

  /** The primary button's key of the current command, `''` where the mode renders no form of its own. */
  readonly submitKey = computed<string>(() => {
    const command = this.command();

    return command === null ? '' : ACTION_COPY[command].submitKey;
  });

  /** Legacy key of the cancel button, which returns to the record without posting anything. */
  readonly cancelKey = 'label.button.cancel';

  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

  /**
   * The approve form: `POST /loans/{id}?command=approve`.
   *
   * `approvedOnDate` is the command's mandatory member and `approvedLoanAmount` the amount the action
   * screen collects — the fork documents it as optional on the request, and the legacy approval screen
   * asks for it — so both carry `Validators.required`; the note is optional and non-nullable, which
   * gives the body builder one shape to read. No `min`, `max` or `pattern` is added to the amount: the
   * approved principal is bounded by the product on the server and nowhere in this application
   * (AAP 0.4.4 decision 6; Rule 1 clause 3).
   *
   * `approvedLoanAmount` is the wire name for the amount approved — not the plan's `approvedPrincipal`,
   * which the fork rejects with HTTP 400 "The parameter approvedPrincipal is not supported" — so the
   * control is named after the member it posts and the body keys cannot drift from the model.
   */
  readonly approveForm = new FormGroup({
    approvedOnDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    approvedLoanAmount: new FormControl<number | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /**
   * The reject form: `POST /loans/{id}?command=reject`.
   *
   * `rejectedOnDate` is the command's mandatory member and starts empty — the approval template
   * carries no rejection date, and inventing one would be a default the legacy screen does not show
   * (Rule 1 clause 3). The note is optional.
   */
  readonly rejectForm = new FormGroup({
    rejectedOnDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /**
   * The disburse form: `POST /loans/{id}?command=disburse`.
   *
   * `actualDisbursementDate` is the command's mandatory member and `transactionAmount` the amount the
   * action screen collects, so both are required; the amount is seeded from the transaction template's
   * own `amount` when it sends one, and stays editable, unbounded and unrounded. There is deliberately
   * no payment-type control: the body has no member for one (see the departure recorded on the class).
   */
  readonly disburseForm = new FormGroup({
    actualDisbursementDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    transactionAmount: new FormControl<number | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /**
   * The undo-approval form: `POST /loans/{id}?command=undoapproval`.
   *
   * The server takes the note and nothing else for this command, so the note is the whole form and
   * the confirm view above it is what states the action being taken (AAP 0.7.2 row
   * `LoanActionRequest`).
   */
  readonly undoapprovalForm = new FormGroup({
    note: new FormControl<string>('', { nonNullable: true }),
  });

  /**
   * Duplicate-submission protection for the one POST: `busy()` drives the submit trigger's disabled
   * state and `runOnce` refuses re-entry, so one click sends one request (AAP 0.14.1, workflow W5).
   */
  readonly guard = createSubmitGuard();

  /**
   * Reads the route's two segments and drives the screen's one load per navigation.
   *
   * One `paramMap` subscription is the whole entry point — never `snapshot` beside a subscription —
   * because Angular reuses this component when the URL moves from one action of the same route to
   * another, and a snapshot read taken at construction would leave the first action's form on screen
   * for the second action's URL. Every emission re-resolves the mode, clears the previous outcome and
   * issues that mode's own read, so the displayed form always belongs to the segment in the address.
   */
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params: ParamMap) => {
      this.resolve(params);
    });
  }

  /**
   * The one producer of the body {@link LoanService.action} posts, shaped by the resolved command.
   *
   * It answers `null` when the mode posts nothing of its own — the repayment form belongs to the child
   * component and a not-found screen has no command — and when a required control holds no usable
   * value, which {@link submit} has already refused. The check is repeated here because the compiler
   * cannot know that the form was validated, and it is what lets every branch build a body without a
   * cast over a value that might be `null`.
   *
   * Dating and the two payload members Fineract needs to parse a date are the service's: this method
   * hands over the `Date` each field holds and adds nothing else. A note is attached only when its
   * trimmed value carries text, so an untouched note field adds no member the legacy body lacked
   * (Rule 1 clause 2).
   *
   * @returns The body to post, or `null` when this mode has nothing valid to post.
   */
  buildRequest(): LoanActionRequest | null {
    const fields = this.assembleFields();

    // `LoanActionRequest` types the payload as it leaves the process; the object assembled above holds
    // the command's own fields, and the two members the model declares for the wire are written by
    // `LoanService.action` as it serialises. This is the one place the two meet.
    return fields === null ? null : (fields as LoanActionRequest);
  }

  /**
   * Posts the resolved command once and returns to the loan record.
   *
   * The current form's controls are marked touched first, so a field that is missing shows the help
   * block the shared fields render, and an invalid form stops there: the required-field set is the
   * commands' own, and nothing else is checked client-side (Rule 1 clause 3). A mode with no command —
   * the repayment form and the not-found outcome — posts nothing at all.
   *
   * On success the screen navigates to `#/viewloanaccount/:id`, where the loan's status, schedule and
   * transactions reflect the action. On failure the mapped `ApiError` is stored in `error()` for the
   * template to render verbatim; every entered value survives, the form is not reset and the screen
   * does not navigate, which is what lets a user correct what the server refused (AAP 0.7.4). No
   * notification is raised here: the interceptor already shows one for a 5xx or a network failure, so
   * a failure produces one message, not two.
   *
   * @returns A promise that settles once the request has been attempted and the screen has navigated
   *   or recorded the failure.
   */
  async submit(): Promise<void> {
    const command = this.command();

    if (command === null || !this.markTouched(command)) {
      return;
    }

    const body = this.buildRequest();

    if (body === null) {
      return;
    }

    await this.send(command, body);
  }

  /**
   * Resolves which screen the route's parameters select, and starts that mode's own read.
   *
   * An `:id` the route does not carry, a blank one, or an `:action` outside the six served modes stops
   * here: the not-found outcome is recorded, no command is set and no request is made, so a URL that
   * names no screen of this application cannot post against a loan (AAP 0.7.4 state rules; AAP 0.9.2).
   * Every other emission sets the id, the mode and its command, and hands the read to {@link load}.
   *
   * @param params The route's parameter map, as `paramMap` emitted it.
   */
  private resolve(params: ParamMap): void {
    const loanId = params.get('id');
    const mode = resolveMode(params.get('action'));

    this.error.set(null);
    this.notFound.set(false);

    if (loanId === null || loanId === '' || mode === 'notfound') {
      this.notFound.set(true);
      this.mode.set('notfound');
      this.command.set(null);
      return;
    }

    this.id.set(loanId);
    this.mode.set(mode);
    this.command.set(COMMAND_BY_MODE[mode]);
    void this.load(mode, loanId);
  }

  /**
   * Runs the resolved mode's one seed read, in the order AAP 0.7.3 row "W5 approve and disburse" lists
   * it: the approval template for `approve` and `reject`, the transactions template for `disburse`, and
   * nothing at all for the two confirm views and the repayment form, which have no defaults to seed.
   *
   * A 404 sets `notFound`, which the template renders in place of the form: the id is not a loan, or
   * not a loan in a state this action applies to. Any other failure sets `error`, whose message is
   * rendered verbatim. Neither unmounts the screen nor resets a form, and no notification is raised
   * here — the interceptor owns that for a 5xx or a network failure (AAP 0.7.4). `loading` is cleared
   * whichever way the read settles, so the form is never withheld for ever.
   *
   * @param mode The served mode whose seed is read.
   * @param loanId Loan the action applies to, as the route delivered it.
   */
  private async load(mode: ServedMode, loanId: number | string): Promise<void> {
    if (mode === 'repayment' || mode === 'undoapproval' || mode === 'undodisbursal') {
      return;
    }

    this.loading.set(true);

    try {
      if (mode === 'disburse') {
        const template: LoanTransactionTemplate = await firstValueFrom(
          this.loans.actionTemplate(loanId, 'disburse'),
        );

        this.seedDisbursement(template);
      } else {
        const template: LoanActionTemplate = await firstValueFrom(this.loans.approvalTemplate(loanId));

        this.seedApproval(template);
      }
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
   * Seeds the approve form's principal from the approval template's own `approvalAmount`.
   *
   * The template serves both dated approval modes, so the value is written whenever the endpoint sends
   * one; a mode that renders no amount field simply does not show it, and one that sends none leaves
   * the field empty and required rather than inventing a figure (Rule 1 clause 3).
   *
   * @param template The approval template the endpoint answered with.
   */
  private seedApproval(template: LoanActionTemplate): void {
    if (template.approvalAmount === undefined) {
      return;
    }

    this.approveForm.controls.approvedLoanAmount.setValue(template.approvalAmount);
  }

  /**
   * Seeds the disburse form's amount from the transaction template's own `amount`.
   *
   * A template that sends no amount leaves the field empty and required, and Fineract decides — the
   * figure is never defaulted to the principal here, because that would be a value the legacy screen
   * only shows when its own template carries one (Rule 1 clause 3).
   *
   * @param template The transactions template the endpoint answered with.
   */
  private seedDisbursement(template: LoanTransactionTemplate): void {
    if (template.amount === undefined) {
      return;
    }

    this.disburseForm.controls.transactionAmount.setValue(template.amount);
  }

  /**
   * Marks the current command's controls as touched and reports whether the form may be posted.
   *
   * Marking first is what makes a missing required field visible instead of silently refused. The
   * undodisbursal view has no controls, so it is always postable; the repayment and not-found modes
   * never reach here, because {@link submit} returns before calling this for a `null` command.
   *
   * @param command The resolved command whose form is on screen.
   * @returns true when the form carries everything the server requires.
   */
  private markTouched(command: LoanCommand): boolean {
    switch (command) {
      case 'approve': {
        this.approveForm.markAllAsTouched();
        return this.approveForm.valid;
      }

      case 'reject': {
        this.rejectForm.markAllAsTouched();
        return this.rejectForm.valid;
      }

      case 'disburse': {
        this.disburseForm.markAllAsTouched();
        return this.disburseForm.valid;
      }

      case 'undoapproval': {
        this.undoapprovalForm.markAllAsTouched();
        return this.undoapprovalForm.valid;
      }

      case 'undodisbursal': {
        return true;
      }
    }
  }

  /**
   * Assembles the resolved command's own fields from the form that belongs to it.
   *
   * One branch per command, so a body can only ever be shaped for the command being posted, and a
   * required value that is somehow missing yields `null` rather than a body with a hole in it.
   *
   * @returns The command's fields, or `null` when the mode posts nothing or a required value is empty.
   */
  private assembleFields(): LoanActionFields | null {
    switch (this.command()) {
      case 'approve': {
        const { approvedOnDate, approvedLoanAmount, note } = this.approveForm.getRawValue();

        if (approvedOnDate === null || approvedLoanAmount === null) {
          return null;
        }

        const fields: ApproveFields = { command: 'approve', approvedOnDate, approvedLoanAmount };
        const trimmed = note.trim();

        if (trimmed !== '') {
          fields.note = trimmed;
        }

        return fields;
      }

      case 'reject': {
        const { rejectedOnDate, note } = this.rejectForm.getRawValue();

        if (rejectedOnDate === null) {
          return null;
        }

        const fields: RejectFields = { command: 'reject', rejectedOnDate };
        const trimmed = note.trim();

        if (trimmed !== '') {
          fields.note = trimmed;
        }

        return fields;
      }

      case 'disburse': {
        const { actualDisbursementDate, transactionAmount, note } = this.disburseForm.getRawValue();

        if (actualDisbursementDate === null || transactionAmount === null) {
          return null;
        }

        const fields: DisburseFields = {
          command: 'disburse',
          actualDisbursementDate,
          transactionAmount,
        };
        const trimmed = note.trim();

        if (trimmed !== '') {
          fields.note = trimmed;
        }

        return fields;
      }

      case 'undoapproval': {
        const fields: UndoApprovalFields = { command: 'undoapproval' };
        const trimmed = this.undoapprovalForm.getRawValue().note.trim();

        if (trimmed !== '') {
          fields.note = trimmed;
        }

        return fields;
      }

      case 'undodisbursal': {
        return { command: 'undodisbursal' };
      }

      default: {
        return null;
      }
    }
  }

  /**
   * Sends one command through the submit guard and returns to the loan record on success.
   *
   * The guarded callback clears the previous failure so a retry does not show a stale message while it
   * is in flight, posts the body once, and navigates to `#/viewloanaccount/:id` with the route's own
   * loan id — the page where the new status and the appended transaction are read back. A failure is
   * recorded as the mapped `ApiError`, which the template renders verbatim while every entered value
   * stays in place; the guard releases the trigger in either outcome.
   *
   * @param command The command being posted, which is the one the body describes.
   * @param body The body {@link buildRequest} assembled for it.
   * @returns A promise that settles once the request has been attempted.
   */
  private send(command: LoanCommand, body: LoanActionRequest): Promise<void> {
    return this.guard.runOnce(async (): Promise<void> => {
      this.error.set(null);

      try {
        await firstValueFrom(this.loans.action(this.id(), command, body));
        await this.router.navigate(['/viewloanaccount', this.id()]);
      } catch (cause: unknown) {
        this.error.set(toDisplayableFailure(cause));
      }
    });
  }
}

