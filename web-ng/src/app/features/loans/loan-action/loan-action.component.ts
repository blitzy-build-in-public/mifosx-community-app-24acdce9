import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, screenFailure, toDisplayableFailure } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type {
  LoanActionRequest,
  LoanActionTemplate,
  LoanCommand,
  LoanTransactionTemplate,
} from '../loan.models';
import { LoanRepaymentComponent } from '../loan-repayment/loan-repayment.component';
import { LoanService, type LoanActionInput } from '../loan.service';
/** What the route's `:action` segment selects: one of the five lifecycle commands, the repayment form, or — for a missing segment or one this application does not serve — the not-found outcome, which issues no request and renders the not-found message (AAP 0.7.4 state rules; AAP 0.9.2). The route's own `data.permission` names exactly the six served segments, so the router refuses an unserved segment before this screen mounts (`loans.routes.ts`); the branch stays because a 404 from a mode's own seed read reaches it too. */
type LoanActionMode = LoanCommand | 'repayment' | 'notfound';

/** The six modes that name a real screen, i.e. every mode but the not-found outcome. */
type ServedMode = Exclude<LoanActionMode, 'notfound'>;

/** The six route segments this screen serves, as a lookup the segment is validated against; `satisfies Record<ServedMode, true>` makes a mode missing from this table — or one the type no longer holds — a compile error, so {@link isServedMode} cannot drift from the union it narrows. The segments are spelled exactly as `loans.routes.ts` and `tools/parity/in-scope-routes.json` fix them. */
const SERVED_MODES = {
  approve: true,
  undoapproval: true,
  reject: true,
  disburse: true,
  undodisbursal: true,
  repayment: true,
} satisfies Record<ServedMode, true>;

/** Whether a raw `:action` segment names a screen this application serves, using `Object.hasOwn` rather than `in` so a segment such as `toString` or `constructor` is refused instead of passing on an inherited member of the object's prototype. */
function isServedMode(value: string): value is ServedMode {
  return Object.hasOwn(SERVED_MODES, value);
}

/** The mode a route segment selects, with the not-found outcome for anything unrecognised: a `null` segment — the route matched without an `:action` — and a word this application does not serve both resolve to `'notfound'`, with no fallback mode and no redirect (AAP 0.7.4). */
function resolveMode(segment: string | null): LoanActionMode {
  return segment === null || !isServedMode(segment) ? 'notfound' : segment;
}

/** The lifecycle command each served mode posts, or `null` for the repayment form, whose endpoint family `POST /loans/{id}/transactions` belongs to `LoanRepaymentComponent` — so this table also states that this component posts nothing in that mode, which is what stops {@link LoanActionComponent.submit} before any request. */
const COMMAND_BY_MODE = {
  approve: 'approve',
  undoapproval: 'undoapproval',
  reject: 'reject',
  disburse: 'disburse',
  undodisbursal: 'undodisbursal',
  repayment: null,
} satisfies Record<ServedMode, LoanCommand | null>;

/** The copy one lifecycle command renders, as translation keys of the shipped legacy bundles rather than sentences (AAP 0.10.2); `FineractMissingTranslationHandler` stands behind a key a bundle lacks, so no raw dotted key can reach the user. */
interface LoanActionCopy {
  /** Heading of the screen: the title the legacy loan action screen renders for this command, whose key `LoanAccountActionsController.js` assigns to `scope.title` for the same route segment. */
  readonly headingKey: string;
  /** Label of the primary button, which submits the command. */
  readonly submitKey: string;
}

/** The five commands' copy, keyed by the command itself; `satisfies Record<LoanCommand, LoanActionCopy>` makes a command added without copy — or copy left behind by a removed command — a compile error, so the template reads the current command's labels through an exhaustive lookup and no `default:` branch can render another action's wording. */
const ACTION_COPY = {
  approve: { headingKey: 'label.heading.approveloanaccount', submitKey: 'label.button.approve' },
  undoapproval: {
    headingKey: 'label.heading.undoapproveloanaccount',
    submitKey: 'label.button.undoapproval',
  },
  reject: { headingKey: 'label.heading.rejectloanaccount', submitKey: 'label.button.reject' },
  disburse: { headingKey: 'label.heading.disburseloanaccount', submitKey: 'label.button.disburse' },
  undodisbursal: {
    headingKey: 'label.heading.undodisburseloanaccount',
    submitKey: 'label.button.undodisbursal',
  },
} satisfies Record<LoanCommand, LoanActionCopy>;

/** The approve body's own fields, taken from the model's `approve` arm: `Pick` keeps `../loan.models` the source of truth for every member's wire name and type while leaving out the two members `LoanService.action` writes itself from the resolved configuration, so the body assembled here reaches the service's own input type with no cast (Rule 1 clause 2; AAP 0.14.1). */
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

/** The undo-approval body: the model's own arm, whose single member is the optional note, taken whole rather than picked because the command takes nothing this screen does not send. */
type UndoApprovalFields = Extract<LoanActionRequest, { command: 'undoapproval' }>;

/** The undo-disbursal body: the model's own arm, which declares no member at all. */
type UndoDisbursalFields = Extract<LoanActionRequest, { command: 'undodisbursal' }>;

/** Every body this screen can assemble, as a union of the five commands' shapes; {@link LoanActionComponent.assembleFields} answers one arm of it per command, so a missing arm is a compile error, and the union is assignable to `LoanService`'s own `LoanActionInput` — the model without the format pair — so the body reaches the service without an assertion anywhere on the path. */
type LoanActionFields =
  | ApproveFields
  | RejectFields
  | DisburseFields
  | UndoApprovalFields
  | UndoDisbursalFields;

/** The day a dated action defaults to: the browser clock's own calendar day, at local midnight (AAP 0.10.5, Rule 1 clause 3). */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The single-purpose loan lifecycle action screen — workflow W5 — mounted at `#/loanaccount/:id/:action` by `loans.routes.ts` under the code `LOAN_ACTION_PERMISSIONS` holds for the `:action` segment the URL names (`APPROVE_LOAN`, `REJECT_LOAN`, `DISBURSE_LOAN`, `APPROVALUNDO_LOAN`, `DISBURSALUNDO_LOAN` or `REPAYMENT_LOAN`), which is also the code the loan record's link to this screen carries; the segment then decides which of six screens renders (AAP 0.7.1, AAP 0.10.4, AAP 0.7.3, AAP 0.1.1, Rule 1 clause 5). */
@Component({
  selector: 'app-loan-action',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    PanelCardComponent,
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
  /** Emits once this screen is destroyed, which ends the subscription the route's `paramMap` keeps and cancels the mode's seed read with it; held explicitly because {@link isCurrent} asks it whether the screen is still alive. */
  private readonly destroyRef = inject(DestroyRef);
  /** Id of the loan the action applies to, as the `:id` segment delivered it — the raw string rather than parsed with `Number()`, because every `LoanService` method accepts `number | string` and the id is spelled in the request path and the return navigation exactly as the route held it; empty until the route resolved, which keeps a not-found screen from carrying an id to post against. */
  readonly id = signal<number | string>('');
  /** The screen the `:action` segment selected, `'notfound'` until resolved and for an unknown segment. */
  readonly mode = signal<LoanActionMode>('notfound');
  /** The lifecycle command being posted, or `null` for the repayment and not-found modes; {@link COMMAND_BY_MODE} is its only producer, so the command and the mode it was resolved from cannot disagree, and a `null` here is what stops {@link submit} before any request. */
  readonly command = signal<LoanCommand | null>(null);
  /** Whether the current mode's seed read is in flight, so the template withholds the form until it settles: raised for a mode that reads a template, lowered by that same run once the read settles, and lowered at once by a mode that issues no read at all, so the form is never withheld behind a run that no longer speaks for the screen. */
  readonly loading = signal(false);
  /** The failure the template renders above the form, or `null` while the last call succeeded. */
  readonly error = signal<ApiError | null>(null);
  /** Whether the screen must render the not-found message — an unknown `:action`, a route without its `:id`, or a 404 from the mode's seed read; held apart from `error` because the template renders it in place of the form, where a Fineract validation failure is rendered above a form the user keeps editing (AAP 0.7.4). */
  readonly notFound = signal(false);
  /** The heading key of the current command, or `''` for the repayment and not-found modes; read through {@link ACTION_COPY}, so the heading and the button below cannot name different commands, and `''` keeps the template from rendering an action heading over the child component or the not-found message. */
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
  /** The approve form: `POST /loans/{id}?command=approve`, where `approvedOnDate` is the command's mandatory member and `approvedLoanAmount` the amount this action screen collects, so both carry `Validators.required`; the note is optional and the amount carries no `min`, `max` or `pattern`, because the product bounds the approved principal on the server and nowhere here (AAP 0.4.4, Rule 1 clause 3). */
  readonly approveForm = new FormGroup({
    approvedOnDate: new FormControl<Date | null>(today(), { validators: [Validators.required] }),
    approvedLoanAmount: new FormControl<number | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });
  /** The reject form: `POST /loans/{id}?command=reject`, whose `rejectedOnDate` is the command's mandatory member and starts at the browser clock's own day, the default legacy's rejection screen assigns with `new Date()` (AAP 0.10.5 item 15); it stays editable and required, so the server decides, and the rejection screen issues no seed read at all because legacy's rejection branch reads no template. The note is optional. */
  readonly rejectForm = new FormGroup({
    rejectedOnDate: new FormControl<Date | null>(today(), { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });
  /** The disburse form: `POST /loans/{id}?command=disburse`, whose `actualDisbursementDate` is the command's mandatory member and `transactionAmount` the amount this screen collects, seeded from the transaction template's own `amount` when it sends one and left editable, unbounded and unrounded. There is deliberately no payment-type control: the body has no member for one (see the departure recorded on the class). */
  readonly disburseForm = new FormGroup({
    actualDisbursementDate: new FormControl<Date | null>(today(), { validators: [Validators.required] }),
    transactionAmount: new FormControl<number | null>(null, { validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true }),
  });
  /** The undo-approval form: `POST /loans/{id}?command=undoapproval`, for which the server takes the note and nothing else, so the note is the whole form and the confirm view above it is what states the action being taken (AAP 0.7.2 row `LoanActionRequest`). */
  readonly undoapprovalForm = new FormGroup({
    note: new FormControl<string>('', { nonNullable: true }),
  });
  /** Duplicate-submission protection for the one POST: `busy()` drives the submit trigger's disabled state and `runOnce` refuses re-entry, so one click sends one request (AAP 0.14.1, workflow W5). */
  readonly guard = createSubmitGuard();
  /** Which seed read is the current one, incremented by every run of {@link load}: the router reuses this component across `#/loanaccount/{id}/{action}`, so a superseded run compares its own number with this one after the await and writes nothing — not the seeded amount, not the not-found or error state, not `loading` — and another loan's template can neither seed the form the URL now shows nor decide what that form reports. */
  private loadSequence = 0;
  /** Reads the route's two segments and drives the screen's one load per navigation: one `paramMap` subscription is the whole entry point and never a `snapshot` read beside it, because Angular reuses this component when the URL moves from one action of the same route to another; every emission re-resolves the mode, clears the previous outcome and issues that mode's own read, so the displayed form always belongs to the segment in the address. */
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params: ParamMap) => {
      this.resolve(params);
    });
  }
  /** The one producer of the body {@link LoanService.action} posts, shaped by the resolved command: it answers `null` when the mode posts nothing of its own — the repayment form belongs to the child component and a not-found screen has no command — and when a required control holds no usable value, which {@link submit} has already refused (Rule 1 clause 2). */
  buildRequest(): LoanActionFields | null {
    return this.assembleFields();
  }
  /** Posts the resolved command once and returns to the loan record: the current form's controls are marked touched first, so a field that is missing shows the help block the shared fields render, and an invalid form stops there — the required set is the commands' own and nothing else is checked client-side (Rule 1 clause 3, AAP 0.7.4). */
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
  /** Resolves which screen the route's parameters select, and starts that mode's own read: an `:id` the route does not carry, a blank one, or an `:action` outside the six served modes stops here — the not-found outcome is recorded, no command is set and no request is made, so a URL naming no screen of this application cannot post against a loan (AAP 0.7.4, AAP 0.9.2). */
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
  /** Runs the resolved mode's own seed read, per mode and never one read on another mode's behalf: `approve` reads the approval template, `disburse` reads the transaction template of its own command, and `reject`, the two confirm views and the repayment form issue no request at all (AAP 0.7.3, AAP 0.7.4). */
  private async load(mode: ServedMode, loanId: number | string): Promise<void> {
    const load = ++this.loadSequence;
    try {
      switch (mode) {
        case 'approve': {
          this.loading.set(true);
          const template: LoanActionTemplate = await firstValueFrom(
            this.loans.approvalTemplate(loanId).pipe(takeUntilDestroyed(this.destroyRef)),
          );
          // Checked before the form is written: an answer that arrives after the route moved on describes another loan, and its figure must not reach the current loan's POST.
          if (this.isCurrent(load)) {
            this.seedApproval(template);
          }
          break;
        }
        case 'disburse': {
          this.loading.set(true);
          const template: LoanTransactionTemplate = await firstValueFrom(
            this.loans.actionTemplate(loanId, 'disburse').pipe(takeUntilDestroyed(this.destroyRef)),
          );
          if (this.isCurrent(load)) {
            this.seedDisbursement(template);
          }
          break;
        }
        default: {
          // No read of its own. `reject` is the one dated action with nothing to seed — its form holds the rejection date and a note, and legacy's rejection branch reads no template either — so it joins the two confirm views and the repayment form here, and the `finally` below releases the loading state this run inherited (AAP 0.7.3; Rule 1 clauses 2, 3).
          break;
        }
      }
    } catch (cause: unknown) {
      if (this.isCurrent(load)) {
        const failure = toDisplayableFailure(cause);
        if (failure.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(screenFailure(failure));
        }
      }
    } finally {
      // Only the current run owns the loading state, and the run that issued no read ends it here: a superseded one must not clear the flag the newer read set, and no mode may leave the form withheld for ever.
      if (this.isCurrent(load)) {
        this.loading.set(false);
      }
    }
  }
  /** Whether a run still speaks for the screen — it is the newest run and the screen it belongs to has not been destroyed — so a read the route or the teardown cancelled can neither seed a form, nor paint a failure, nor clear the loading state of whatever replaced it. */
  private isCurrent(load: number): boolean {
    return !this.destroyRef.destroyed && load === this.loadSequence;
  }
  /** Seeds the approve form's principal from the approval template's own `approvalAmount`, the template's only reader: the rejection form holds no amount, and a template that sends none leaves the field empty and required (Rule 1 clause 3). */
  private seedApproval(template: LoanActionTemplate): void {
    if (template.approvalAmount === undefined) {
      return;
    }
    this.approveForm.controls.approvedLoanAmount.setValue(template.approvalAmount);
  }
  /** Seeds the disburse form's amount from the transaction template's own `amount`; a template that sends no amount leaves the field empty and required and lets Fineract decide, because defaulting it to the principal would be a figure the legacy screen only shows when its own template carries one (Rule 1 clause 3). */
  private seedDisbursement(template: LoanTransactionTemplate): void {
    if (template.amount === undefined) {
      return;
    }
    this.disburseForm.controls.transactionAmount.setValue(template.amount);
  }
  /** Marks the current command's controls as touched and reports whether the form may be posted: marking first is what makes a missing required field visible instead of silently refused, and the undodisbursal view, which has no controls, is always postable. */
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
  /** Assembles the resolved command's own fields from the form that belongs to it: one branch per command, so a body can only ever be shaped for the command being posted, and a required value that is somehow missing yields `null` rather than a body with a hole in it. */
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
  /** Sends one command through the submit guard and returns to the loan record on success: the guarded callback clears the previous failure so a retry does not show a stale message while it is in flight, posts the body once, and navigates to `#/viewloanaccount/:id` where the new status and the appended transaction are read back (AAP 0.7.4). */
  private send(command: LoanCommand, body: LoanActionInput): Promise<void> {
    return this.guard.runOnce(async (): Promise<void> => {
      this.error.set(null);
      try {
        await firstValueFrom(this.loans.action(this.id(), command, body));
        await this.router.navigate(['/viewloanaccount', this.id()]);
      } catch (cause: unknown) {
        this.error.set(screenFailure(cause));
      }
    });
  }
}
