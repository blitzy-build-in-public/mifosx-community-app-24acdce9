import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { DataTableGateService } from '../../../core/api/datatable-gate.service';
import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import { PanelCardComponent } from '../../../shared/panel-card/panel-card.component';
import { RecordNotFoundComponent } from '../../../shared/record-not-found/record-not-found.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import { CLIENT_ACTION_PERMISSIONS, type ClientActionCommand } from '../client.models';
import { ClientService, type ClientActionInput } from '../client.service';

  /**
   * The copy one lifecycle command renders, as translation keys of the shipped legacy bundles rather than sentences: every key is read from `app/global-translations/locale-*.json` in place (Rule 1 clause 6) and `FineractMissingTranslationHandler` stands behind the ones a bundle might lack (AAP 0.10.2).
   */
interface ClientActionCopy {
  /** Heading of the screen: the legacy step title, which is the action's own anchor label. */
  readonly headingKey: string;

  /** Label of the primary button. All five commands submit with the legacy form's own button. */
  readonly submitKey: string;

  /** Label of the action's date field, e.g. "Closure date". */
  readonly dateLabelKey: string;

  /** Label of the command's reason select, or `''` for a command that takes no reason. */
  readonly reasonLabelKey: string;
}

  /**
   * The five commands' copy, keyed by the command itself: `satisfies Record<ClientActionCommand, ClientActionCopy>` makes a command without copy, or copy left behind by a removed command, a compile error. The keys are the legacy client-actions template's own — the `breadcrumbName` heading (`label.anchor.*`), its `labelName` and `labelNamereason`, and the `label.button.save` it shows for all five (Rule 1 clause 3); `activate` and `reactivate` take no reason, which is why their `reasonLabelKey` is empty.
   */
const ACTION_COPY = {
  activate: {
    headingKey: 'label.anchor.activate',
    submitKey: 'label.button.save',
    dateLabelKey: 'label.input.activationdate',
    reasonLabelKey: '',
  },
  close: {
    headingKey: 'label.anchor.close',
    submitKey: 'label.button.save',
    dateLabelKey: 'label.input.closuredate',
    reasonLabelKey: 'label.input.closurereason',
  },
  reject: {
    headingKey: 'label.anchor.reject',
    submitKey: 'label.button.save',
    dateLabelKey: 'label.input.rejectiondate',
    reasonLabelKey: 'label.input.rejectionreason',
  },
  withdraw: {
    headingKey: 'label.anchor.withdraw',
    submitKey: 'label.button.save',
    dateLabelKey: 'label.input.withdrawaldate',
    reasonLabelKey: 'label.input.withdrawalreason',
  },
  reactivate: {
    headingKey: 'label.anchor.reactivate',
    submitKey: 'label.button.save',
    dateLabelKey: 'label.input.reactivationdate',
    reasonLabelKey: '',
  },
} satisfies Record<ClientActionCommand, ClientActionCopy>;

  /**
   * The five in-scope commands as a lookup, so the `:action` segment is validated against the `ClientActionCommand` union without a cast and without a list that could drift from it: `satisfies Record<ClientActionCommand, true>` makes a missing member, or one the union no longer holds, a compile error, and {@link isClientActionCommand} is the single runtime test.
   */
const ACTION_COMMANDS = {
  activate: true,
  close: true,
  reject: true,
  withdraw: true,
  reactivate: true,
} satisfies Record<ClientActionCommand, true>;

  /**
   * Whether a raw `:action` segment is one of the five in-scope lifecycle commands, tested with `Object.hasOwn` rather than `in` so a segment such as `toString` is refused instead of passing on an inherited member. `@param value` the `:action` segment as the route delivered it; `@returns` true when it names a command this screen posts.
   */
function isClientActionCommand(value: string): value is ClientActionCommand {
  return Object.hasOwn(ACTION_COMMANDS, value);
}

  /**
   * Today at local midnight: the activation date a new action screen starts on, and the one clock read in this file. A form's default date follows the browser clock rather than the tenant business date, departing from Rule 1 clause 2 on purpose: reading the business date here would add a request the legacy screen never makes and register as a request difference in every parity workflow, so the run date is derived where dates must be authoritative, in the E2E harness (AAP 0.10.5 item 15; AAP 0.12). Local midnight rather than `new Date()`, and built part by part rather than from a `'yyyy-MM-dd'` string, which `Date` reads as UTC midnight.
   */
function todayAtLocalMidnight(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

  /**
   * The text a failed call paints on this screen: Fineract's own message for a 4xx, which a screen renders verbatim (AAP 0.4.4 decision 6, workflow W7) and which leaves the screen usable (AAP 0.7.4), and nothing for a failure the interceptor has already reported — `core/http/fineract.interceptor.ts` raises the single notification for a transport fault and for any status at or above 500 (AAP 0.7.4), so painting it here would report it twice. Nothing is logged (Rule 1 clause 9). `@param error` the value a failed call rejected with.
   */
function failureMessage(error: unknown): string | null {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : null;
}

  /**
   * The single-purpose form behind one client lifecycle action — `#/client/:id/:action` (AAP 0.8.2; AAP 0.7.1 Features row `clients`). In legacy's order: read `:id` and `:action` from the route, refuse an `:action` that is not one of the five in-scope commands, run the datatable gate the legacy `ClientActionsController` runs first, load the reason list for the three commands that take one, render the form, then post exactly one command and return to the record. The five are `POST /clients/{id}?command=activate`, `=close`, `=reject`, `=withdraw` and `=reactivate` (AAP 0.7.3 row "Client actions"), and the gate runs once per load and never on submit: `DataTableGateService.checkClientActionGate` performs the legacy two-call sequence — the datatable-check list, then one generic-result-set read per applicable check (AAP 0.7.3 row "Client actions: datatable gate"; AAP 0.3.4 claim 13), a failed gate leaving the form unrendered. Reason ids come from the tenant: `close`, `reject` and `withdraw` read `GET /clients/template?commandParam=<command>` and render its `narrations` in the server's order (AAP 0.7.3 row "Client actions"), while `activate` and `reactivate` issue no template call; no URL, HTTP client, configuration read or date format appears here (Rule 1 clauses 2 and 5; AAP 0.7.2 "Date handling"; AAP 0.14.1).
   *
   * It matches legacy rather than improving it: every control of every form is required, and each rule is one legacy or Fineract already states — the action date, because Fineract's validator declares it `notNull`, and the reason, because the legacy template marks its label with the required asterisk and `ClientDataValidator.validateClose`, `validateRejection` and `validateWithdrawn` all declare the reason id `notNull().longGreaterThanZero()`. Enforcing the reason departs from Rule 1 clause 3 on purpose: the rule it enforces is the legacy template's own, the required-field rules being inherited rather than left decorative (AAP 0.4.4 decision 6), and each invalid control renders the legacy `label.requiredfield` message in the slot the shared fields project into. No other validator is added — the legacy datepicker's min/max bound is not re-implemented (AAP 0.7.4) — and the one registered difference is the native date input the shared `DateField` renders (AAP 0.10.5 item 1). One request per click through `shared/submit-guard.util.ts` (AAP 0.1.1; AAP 0.10.1 W5), every visual value from the template and the global Bootstrap 3 layer (Rule 1 clause 6; AAP 0.4.4 decision 4), and nothing logged (Rule 1 clause 9).
   */
@Component({
  selector: 'app-client-actions',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    SelectFieldComponent,
    PanelCardComponent,
    RecordNotFoundComponent,
    HasPermissionDirective,
  ],
  templateUrl: './client-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientActionsComponent {
  /** The clients family's one typed service: the only Fineract caller this screen reaches. */
  private readonly client = inject(ClientService);

  /** The datatable gate's two calls, in legacy's order, run before any command is posted. */
  private readonly dataTableGate = inject(DataTableGateService);

  /** The route whose `:id` and `:action` segments name the record and the command. */
  private readonly route = inject(ActivatedRoute);

  /** The router the cancel link shares and the navigation back to the record. */
  private readonly router = inject(Router);

  /** Completes the route subscription should the screen be destroyed before it emits. */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Which load is the current one, incremented by every emission of the route's parameters: a superseded load compares its own number with this one after each await and returns instead of writing its answer, so a slow earlier response can never put the previous command's message or reasons on the screen.
   */
  private loadSequence = 0;

  /**
   * Id of the client the command applies to, as the `:id` segment delivered it, empty until the route emits — kept as the raw string because the gate and `ClientService.action` both accept `number | string` and the id is spelled in the path, the request and the return navigation exactly as the route held it.
   */
  readonly clientId = signal<string>('');

  /** The command in progress, or `null` before the route emitted and for an unknown segment. */
  readonly command = signal<ClientActionCommand | null>(null);

  /**
   * The permission the current command's submit button is gated on, or the empty string while the route names no command yet — the state the gate fails closed in rather than offering a control whose endpoint would refuse the post (AAP 0.9.1 item 1).
   */
  readonly actionPermission = computed<string>(() => {
    const command = this.command();

    return command === null ? '' : CLIENT_ACTION_PERMISSIONS[command];
  });

  /**
   * Whether the gate — and, for a command that takes a reason, the reason list — has resolved: the template renders the form only when this is true, so a failure in either step keeps the form, its fields and its button off the screen rather than enabled against a gate that never answered.
   */
  readonly ready = signal(false);

  /**
   * The one failure region, shared by a failed gate, a failed reason-list read and a failed command: Fineract's own message for a 4xx, verbatim and untranslated (AAP 0.4.4 decision 6; workflow W7), `null` while there is nothing to report and for the failures the interceptor has already raised a notification for (AAP 0.7.4).
   */
  readonly error = signal<string | null>(null);

  /**
   * Whether the `:action` segment names no in-scope command — `#/client/2/nonsense`, or a legacy action this migration does not deliver: such a screen calls neither the gate nor the command and renders the not-found message instead, which is why nothing here can post an unknown command.
   */
  readonly notFound = signal(false);

  /** The reasons `close`, `reject` and `withdraw` offer, in the order the template returned them; empty for a command that takes none or before the read resolves. */
  readonly reasonOptions = signal<readonly SelectOption[]>([]);

  /** Legacy key of the cancel button, which returns to the record without posting anything. */
  readonly cancelKey = 'label.button.cancel';

  /**
   * Legacy key of the empty row the reason select leads with, `label.select` ("Select an option"): the legacy `ng-options` select rendered an empty option while no reason was chosen, so the template passes this to `SelectFieldComponent` as its `placeholder`; empty for `activate` and `reactivate`, which render no select at all.
   */
  readonly reasonPlaceholderKey = 'label.select';

  /**
   * The activation form: `POST /clients/{id}?command=activate`. The date is pre-filled with the browser's today — the default AAP 0.10.5 item 15 registers — and it is the only control, because `activate` takes no reason; `Validators.required` is the whole rule, the server being what refuses an activation that lacks a date (Rule 1 clause 3). The legacy datepicker also bounded this date between the client's submission date and today; that bound is deliberately not re-implemented (AAP 0.4.4 decision 6 and AAP 0.7.2), so an out-of-range date is refused by Fineract with the message this screen shows.
   */
  readonly activateForm = new FormGroup({
    activationDate: new FormControl<Date | null>(todayAtLocalMidnight(), {
      validators: [Validators.required],
    }),
  });

  /**
   * The closure form: `POST /clients/{id}?command=close`, its date starting empty because AAP 0.10.5 item 15's browser-clock defaults name an activation date and not a closure. Both controls are required, and each rule is one the server states: the date, because a closure that lacks one is refused, and the reason, because the legacy template marks its label with the required asterisk and `ClientDataValidator.validateClose` declares the id `notNull().longGreaterThanZero()`; the reason id remains the tenant's configured one the select renders, and choosing a row is what makes the form valid.
   */
  readonly closeForm = new FormGroup({
    closureDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    // Rule 1 clause 3 asks these forms to add no client-side validation legacy lacks. This one is not added but inherited: the legacy client-actions template marks this select with its required asterisk, so enforcing what the legacy form declares is the rule the new form carries over, and the body it blocks is the one Fineract's `validateClose` refuses anyway.
    closureReasonId: new FormControl<SelectValue | null>(null, {
      validators: [Validators.required],
    }),
  });

  /**
   * The rejection form: `POST /clients/{id}?command=reject`, its date empty and required, and its reason required for the same two reasons the closure reason is — the legacy template's required asterisk and `ClientDataValidator.validateRejection`'s `notNull().longGreaterThanZero()`.
   */
  readonly rejectForm = new FormGroup({
    rejectionDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    rejectionReasonId: new FormControl<SelectValue | null>(null, {
      validators: [Validators.required],
    }),
  });

  /**
   * The withdrawal form: `POST /clients/{id}?command=withdraw`, its date empty and required, and its reason required as the other two reason commands' are — the legacy template's required asterisk and `ClientDataValidator.validateWithdrawn`'s `notNull().longGreaterThanZero()`.
   */
  readonly withdrawForm = new FormGroup({
    withdrawalDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    withdrawalReasonId: new FormControl<SelectValue | null>(null, {
      validators: [Validators.required],
    }),
  });

  /**
   * The reactivation form: `POST /clients/{id}?command=reactivate`, carrying a date because the command requires one — `ClientActionRequest`'s `reactivate` variant declares `reactivationDate`, the fork validates that member with `notNull`, and the legacy screen renders the field under `label.input.reactivationdate` and posts it, so a confirm-only screen would send a body the server refuses. It starts empty: a reactivation date is not one of the defaults AAP 0.10.5 item 15 lists, and inventing one would be an improvement the legacy screen does not make (Rule 1 clause 3).
   */
  readonly reactivateForm = new FormGroup({
    reactivationDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
  });

  /**
   * Duplicate-submission protection for the primary button: `busy()` disables it while the command is in flight, and a re-entrant click is refused rather than queued, so one click posts once.
   */
  readonly guard = createSubmitGuard();

  /**
   * The current command's copy, or `null` before the route resolved and for an unknown segment: every label below reads it, so all four agree with the command the form is bound to.
   */
  private readonly copy = computed<ClientActionCopy | null>(() => {
    const command = this.command();

    return command === null ? null : ACTION_COPY[command];
  });

  /** Heading key of the current command, e.g. `label.anchor.close`; empty for no command. */
  readonly headingKey = computed<string>(() => this.copy()?.headingKey ?? '');

  /** Primary-button key of the current command: the legacy form's own submit button. */
  readonly submitKey = computed<string>(() => this.copy()?.submitKey ?? '');

  /** Date-field key of the current command, e.g. `label.input.closuredate`. */
  readonly dateLabelKey = computed<string>(() => this.copy()?.dateLabelKey ?? '');

  /**
   * Reason-select key of the current command, empty for `activate` and `reactivate`: the template renders the select from this, so a command that takes no reason cannot show an empty picker.
   */
  readonly reasonLabelKey = computed<string>(() => this.copy()?.reasonLabelKey ?? '');

  /**
   * Whether a control shows the legacy required message, which the template projects into the slot `app-date-field` and `app-select-field` render after their control — the same caption a required control on the create and edit screens shows. A method rather than a signal because `hasError`, `touched` and `dirty` are plain properties of a `FormControl`, so a computed would keep the first verdict for ever; `touched || dirty` keeps the message from greeting a user who has not reached the field, and `submit()` marking the form as touched makes it appear after a refused save. `@param control` the form control the field renders; `@returns` true when it is missing a required value and has been visited or edited.
   */
  protected showsRequiredError(control: AbstractControl): boolean {
    return control.hasError('required') && (control.touched || control.dirty);
  }

  /**
   * Reads the route's two segments and drives the screen's one load sequence: one subscription is the whole entry point — never `snapshot` beside a subscription — so the gate runs once per navigation and never twice for one load, and it stays open for the life of the instance because Angular reuses this component when the URL moves from one action to another on the same route.
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        void this.load(params);
      });
  }

  /**
   * Posts the current command, once: it does nothing until the screen is ready, marks the current form's controls as touched so every required control that is still empty renders the message the shared field projects instead of turning its label and border red alone, and returns before issuing a request when the form is invalid, so no body Fineract would refuse is sent. The three reason commands validate both their date and their reason, `activate` and `reactivate` validate the date, and otherwise it hands the command's own fields to {@link send}, which formats nothing.
   */
  submit(): void {
    const command = this.command();

    if (command === null || !this.ready()) {
      return;
    }

    switch (command) {
      case 'activate': {
        this.activateForm.markAllAsTouched();

        if (this.activateForm.invalid) {
          return;
        }

        this.send('activate', {
          command: 'activate',
          activationDate: this.activateForm.controls.activationDate.value,
        });
        return;
      }

      case 'close': {
        this.closeForm.markAllAsTouched();

        if (this.closeForm.invalid) {
          return;
        }

        const closureReasonId = this.closeForm.controls.closureReasonId.value;

        // The select writes its option's id, which the reason list sends as a number. The member is spread only once an id is held, so a body never carries a placeholder `null` the server would read as a choice.
        this.send('close', {
          command: 'close',
          closureDate: this.closeForm.controls.closureDate.value,
          ...(typeof closureReasonId === 'number' ? { closureReasonId } : {}),
        });
        return;
      }

      case 'reject': {
        this.rejectForm.markAllAsTouched();

        if (this.rejectForm.invalid) {
          return;
        }

        const rejectionReasonId = this.rejectForm.controls.rejectionReasonId.value;

        // Conditional for the same reason as the closure branch above: the member carries the id the select holds, never a placeholder `null` the server would read as a choice.
        this.send('reject', {
          command: 'reject',
          rejectionDate: this.rejectForm.controls.rejectionDate.value,
          ...(typeof rejectionReasonId === 'number' ? { rejectionReasonId } : {}),
        });
        return;
      }

      case 'withdraw': {
        this.withdrawForm.markAllAsTouched();

        if (this.withdrawForm.invalid) {
          return;
        }

        const withdrawalReasonId = this.withdrawForm.controls.withdrawalReasonId.value;

        this.send('withdraw', {
          command: 'withdraw',
          withdrawalDate: this.withdrawForm.controls.withdrawalDate.value,
          ...(typeof withdrawalReasonId === 'number' ? { withdrawalReasonId } : {}),
        });
        return;
      }

      case 'reactivate': {
        this.reactivateForm.markAllAsTouched();

        if (this.reactivateForm.invalid) {
          return;
        }

        this.send('reactivate', {
          command: 'reactivate',
          reactivationDate: this.reactivateForm.controls.reactivationDate.value,
        });
        return;
      }
    }
  }

  /**
   * Runs the load sequence for the route's parameters, in the order the legacy controller runs it: an `:id` or `:action` the route does not carry, or an `:action` outside the five commands, stops here with the not-found message and no request at all; otherwise the gate runs and is awaited first, and a failed gate reports what {@link failureMessage} answers and stops before the reason list is read, so the form is never rendered for a client whose checks did not answer. Only `close`, `reject` and `withdraw` then read their reason list, and `ready` becomes true once everything the form needs is in hand. `@param params` the route's parameter map.
   */
  private async load(params: ParamMap): Promise<void> {
    const load = ++this.loadSequence;
    const clientId = params.get('id');
    const action = params.get('action');

    if (clientId === null || action === null || !isClientActionCommand(action)) {
      this.notFound.set(true);
      return;
    }

    this.clientId.set(clientId);
    this.command.set(action);
    this.notFound.set(false);
    this.ready.set(false);
    this.error.set(null);
    this.reasonOptions.set([]);

    try {
      await firstValueFrom(this.dataTableGate.checkClientActionGate(clientId, action));
    } catch (error: unknown) {
      if (load === this.loadSequence) {
        this.error.set(failureMessage(error));
      }
      return;
    }

    if (load !== this.loadSequence) {
      return;
    }

    if (action !== 'activate' && action !== 'reactivate') {
      try {
        const template = await firstValueFrom(this.client.commandParam(action));

        if (load !== this.loadSequence) {
          return;
        }

        this.reasonOptions.set(template.narrations);
      } catch (error: unknown) {
        if (load === this.loadSequence) {
          this.error.set(failureMessage(error));
        }
        return;
      }
    }

    this.ready.set(true);
  }

  /**
   * Posts one command through the submit guard and returns to the client record on success: the guarded callback clears the previous failure, hands the command's own fields to `ClientService.action` — which supplies `dateFormat` and `locale` at the boundary — and awaits the one POST. Success navigates to `#/viewclient/:id` with the route's client id, as the legacy controller does; failure records the message a 4xx answered with, verbatim, keeping every entered value, while a 5xx or transport failure stays the interceptor's one notification (AAP 0.7.4). The guard releases the button in either outcome. `@param command` the command being posted; `@param fields` that command's own fields, as its form holds them, the date-format pair not among them.
   */
  private send(command: ClientActionCommand, fields: ClientActionInput): void {
    void this.guard.runOnce(async (): Promise<void> => {
      this.error.set(null);

      try {
        await firstValueFrom(this.client.action(this.clientId(), command, fields));

        await this.router.navigate(['/viewclient', this.clientId()]);
      } catch (error: unknown) {
        this.error.set(failureMessage(error));
      }
    });
  }
}
