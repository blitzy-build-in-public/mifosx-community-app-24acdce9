import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, type ParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { DataTableGateService } from '../../../core/api/datatable-gate.service';
import { ApiError } from '../../../core/http/api-error';
import { DateFieldComponent } from '../../../shared/date-field/date-field.component';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ClientActionCommand } from '../client.models';
import { ClientService, type ClientActionInput } from '../client.service';

/**
 * The copy one lifecycle command renders, as translation keys of the shipped legacy bundles rather
 * than sentences. Every key below is read from `app/global-translations/locale-*.json` in place
 * (Rule 1 clause 6), so each label resolves in English and in a non-English locale, and
 * `FineractMissingTranslationHandler` stands behind the ones a bundle might lack, so no raw dotted
 * key can reach the user (AAP 0.10.2).
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
 * The five commands' copy, keyed by the command itself.
 *
 * `satisfies Record<ClientActionCommand, ClientActionCopy>` is the point of the declaration: a
 * command added to the union without copy, or copy left behind by a command removed from it, is a
 * compile error, so the template reads the current command's labels through an exhaustive lookup and
 * no `default:` branch can quietly render another action's wording.
 *
 * The keys are the legacy client-actions template's own: the heading is the `breadcrumbName` it
 * renders as the step title (`label.anchor.*`), the date and reason labels are its `labelName` and
 * `labelNamereason` values, and the button is the `label.button.save` it shows for every one of the
 * five actions — "Submit", not a per-action verb (Rule 1 clause 3). `activate` and `reactivate` take
 * no reason, which is why their `reasonLabelKey` is empty rather than a key nothing would send.
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
 * The five in-scope commands as a lookup, so the `:action` segment can be validated against the
 * `ClientActionCommand` union without a cast and without a list that could drift from it.
 *
 * `satisfies Record<ClientActionCommand, true>` makes a member missing from this object, or one the
 * union no longer holds, a compile error; `isClientActionCommand` is then the single runtime test
 * the route segment passes through, and the type predicate it declares is that compile-time proof
 * carried into the type system rather than an assertion about a string.
 */
const ACTION_COMMANDS = {
  activate: true,
  close: true,
  reject: true,
  withdraw: true,
  reactivate: true,
} satisfies Record<ClientActionCommand, true>;

/**
 * Whether a raw `:action` segment is one of the five in-scope lifecycle commands.
 *
 * `Object.hasOwn` rather than `in`, so a segment such as `toString` or `constructor` is refused
 * instead of passing on an inherited member of the object's prototype.
 *
 * @param value the `:action` segment exactly as the route delivered it.
 * @returns true when the segment names a command this screen posts.
 */
function isClientActionCommand(value: string): value is ClientActionCommand {
  return Object.hasOwn(ACTION_COMMANDS, value);
}

/**
 * Today at local midnight: the activation date a new action screen starts on.
 *
 * The one clock read in this file, and the legacy behaviour it reproduces. A form's own default date
 * follows the browser clock rather than the tenant business date, which is where this departs from
 * Rule 1 clause 2's business-date requirement on purpose: reading the business date here would add a
 * request the legacy screen never makes and register as a request difference in every parity
 * workflow, so the run date is derived where dates must be authoritative — in the E2E harness
 * (AAP 0.10.5 item 15; AAP 0.12). Local midnight rather than `new Date()` so the value is the
 * calendar day the field shows, and built part by part rather than from a `'yyyy-MM-dd'` string,
 * which `Date` would read as UTC midnight and render as the previous day anywhere west of
 * Greenwich.
 *
 * @returns the browser's current calendar day at 00:00 local time.
 */
function todayAtLocalMidnight(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The text a failed command shows, taken from the failure itself and altered in no way.
 *
 * `ApiError` is the interceptor's mapped failure and carries Fineract's own
 * `defaultUserMessage` as its message, which is what a screen must render verbatim (AAP 0.4.4
 * decision 6, workflow W7). Anything else that can be thrown — a transport fault the interceptor
 * did not map, a programming error in a dependency — reports its own message, and a throw that is
 * not an `Error` reports nothing rather than `[object Object]`. Nothing is logged: a client id, a
 * reason id, a body or a credential must never reach the console (Rule 1 clause 9).
 *
 * @param error the value a failed call rejected with.
 * @returns displayable text, or `''` when the value carries none.
 */
function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : '';
}

/**
 * The single-purpose form behind one client lifecycle action — `#/client/:id/:action` (AAP 0.8.2;
 * AAP 0.7.1 Features row `clients`).
 *
 * **What it does, in the order legacy runs it.** It reads `:id` and `:action` from the route, refuses
 * an `:action` that is not one of the five in-scope commands, runs the datatable gate the legacy
 * `ClientActionsController` runs first, loads the reason list for the three commands that take one,
 * and only then renders the form. Submitting posts exactly one command and returns to the client
 * record. The five commands are `POST /clients/{id}?command=activate`, `=close`, `=reject`,
 * `=withdraw` and `=reactivate` (AAP 0.7.3 row "Client actions").
 *
 * **The gate comes first and runs once.** `DataTableGateService.checkClientActionGate` performs the
 * legacy two-call sequence — the tenant's datatable-check list, then one generic-result-set read per
 * applicable check — and this screen neither re-implements nor reorders it (AAP 0.7.3 row "Client
 * actions: datatable gate"; AAP 0.3.4 claim 13). It runs once per screen load and never again on
 * submit, because a second gate call would add requests the legacy screen never makes. A gate that
 * fails leaves the form unrendered with the interceptor's own message on screen; a failed gate is
 * never treated as a pass.
 *
 * **Reason ids come from the tenant, never from this file.** `close`, `reject` and `withdraw` read
 * `GET /clients/template?commandParam=<command>` and render its `narrations` in the server's order,
 * unsorted, unfiltered and unrenamed, because the configured reasons differ per tenant (AAP 0.7.3
 * row "Client actions"). `activate` and `reactivate` take no reason and issue no template call.
 *
 * **No URL, no HTTP, no configuration.** The family's `ClientService` composes every path and query
 * parameter and supplies `dateFormat` and `locale` from the resolved configuration and the active
 * language; `DataTableGateService` owns the gate's two calls; `core/http/fineract.interceptor.ts`
 * adds the headers and maps failures. This file therefore holds no URL literal, no HTTP client, no
 * query builder, no configuration read and no date format of its own: a form hands the command's own
 * fields and the service supplies the pair at the boundary (Rule 1 clauses 2 and 5; AAP 0.7.2 "Date
 * handling"; AAP 0.14.1). Because a form's default date follows the browser clock (AAP 0.10.5 item
 * 15) and the run date belongs to the harness, it reads no business date either.
 *
 * **Matching legacy rather than improving it.** The only validator is the action date the server
 * requires: the reason is posted as chosen — including none at all — exactly as legacy's unvalidated
 * reason select posts it, and Fineract's own message is what reaches the user (Rule 1 clause 3;
 * AAP 0.7.4). No body is blocked by a rule Fineract does not state (AAP 0.4.4 decision 6). The
 * server's own message is rendered verbatim, the entered values survive a failure, and the screen
 * offers no note field, no confirmation dialogue, no success toast and no client summary, because the
 * legacy screen offers none. The one registered difference is the native date input the shared
 * `DateField` renders in place of the jQuery datepicker (AAP 0.10.5 item 1).
 *
 * **One request per click.** Every submit goes through `shared/submit-guard.util.ts`, whose `busy`
 * signal disables the primary button while the call is in flight, so a double click posts once — the
 * behaviour workflow W5 asserts (AAP 0.1.1; AAP 0.10.1 W5).
 *
 * **Presentation.** The template and the global Bootstrap 3 layer in `web-ng/src/styles.scss` own
 * every visual value, which is why this file declares no stylesheet, no inline style and no colour
 * (Rule 1 clause 6; AAP 0.4.4 decision 4). Nothing is logged: no client id, reason id, body or
 * credential reaches the console (Rule 1 clause 9).
 */
@Component({
  selector: 'app-client-actions',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DateFieldComponent, SelectFieldComponent],
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
   * Which load is the current one, incremented by every emission of the route's parameters.
   *
   * A superseded load — one still awaiting a response when the URL moved to another action — compares
   * its own number with this one after each await and returns instead of writing its answer, so a slow
   * earlier response can never put the previous command's message or reasons on the screen.
   */
  private loadSequence = 0;

  /**
   * Id of the client the command applies to, as the `:id` segment delivered it.
   *
   * Kept as the raw string segment rather than parsed with `Number()`: the gate and
   * `ClientService.action` both accept `number | string`, a route parameter arrives as text, and the
   * id is spelled in the path, the request and the return navigation exactly as the route held it.
   * Empty until the route emits.
   */
  readonly clientId = signal<string>('');

  /** The command in progress, or `null` before the route emitted and for an unknown segment. */
  readonly command = signal<ClientActionCommand | null>(null);

  /**
   * Whether the gate — and, for a command that takes a reason, the reason list — has resolved.
   *
   * The template renders the form only when this is true, so a failure in either step keeps the form,
   * its fields and its button off the screen rather than enabled against a gate that never answered.
   */
  readonly ready = signal(false);

  /**
   * The one failure region, shared by a failed gate, a failed reason-list read and a failed command:
   * the server's own message, verbatim and untranslated (AAP 0.4.4 decision 6; workflow W7). `null`
   * while there is nothing to report.
   */
  readonly error = signal<string | null>(null);

  /**
   * Whether the `:action` segment names no in-scope command — `#/client/2/nonsense`, or a legacy
   * action this migration does not deliver. Such a screen calls neither the gate nor the command and
   * renders the not-found message instead, which is why nothing here can post an unknown command.
   */
  readonly notFound = signal(false);

  /**
   * The reasons `close`, `reject` and `withdraw` offer, in the order the template returned them, and
   * empty for a command that takes none or before the read resolves.
   */
  readonly reasonOptions = signal<readonly SelectOption[]>([]);

  /** Legacy key of the cancel button, which returns to the record without posting anything. */
  readonly cancelKey = 'label.button.cancel';

  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

  /**
   * Legacy key of the empty row the reason select leads with, `label.select` ("Select an option").
   *
   * The legacy `ng-options` select rendered an empty option while no reason was chosen, so the
   * template passes this to `SelectFieldComponent` as its `placeholder`; without it an empty control
   * shows no row of its own and looks like a reason already chosen. Empty for `activate` and
   * `reactivate`, which render no select at all.
   */
  readonly reasonPlaceholderKey = 'label.select';

  /**
   * The activation form: `POST /clients/{id}?command=activate`.
   *
   * The date is pre-filled with the browser's today, the default AAP 0.10.5 item 15 registers for an
   * activation date, and it is the only control: `activate` takes no reason. `Validators.required` is
   * the whole rule, because the server is what refuses an activation that lacks a date (Rule 1
   * clause 3).
   *
   * The legacy datepicker also bounded this date to between the client's submission date and today.
   * That bound is deliberately not re-implemented as a validator: the plan carries the legacy forms'
   * required-field rules and adds no validation of its own, so an out-of-range date is refused by
   * Fineract with the message this screen shows verbatim. Rule 1 clause 3 is honoured on the
   * required set and departs here on purpose, which AAP 0.4.4 decision 6 and AAP 0.7.2 settle.
   */
  readonly activateForm = new FormGroup({
    activationDate: new FormControl<Date | null>(todayAtLocalMidnight(), {
      validators: [Validators.required],
    }),
  });

  /**
   * The closure form: `POST /clients/{id}?command=close`.
   *
   * Its date starts empty, because AAP 0.10.5 item 15's browser-clock defaults name an activation
   * date and not a closure, and the date is the form's only validated control, because the server
   * requires it. The reason id is the tenant's configured one the select renders and carries no
   * validator, so whatever is chosen — including nothing — is posted and Fineract's own message is
   * what reaches the screen, exactly as legacy behaves (Rule 1 clause 3; AAP 0.7.4).
   */
  readonly closeForm = new FormGroup({
    closureDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    closureReasonId: new FormControl<SelectValue | null>(null),
  });

  /**
   * The rejection form: `POST /clients/{id}?command=reject`, its date empty and required by the
   * server, its reason posted as chosen with no validator of this form's own.
   */
  readonly rejectForm = new FormGroup({
    rejectionDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    rejectionReasonId: new FormControl<SelectValue | null>(null),
  });

  /**
   * The withdrawal form: `POST /clients/{id}?command=withdraw`, its date empty and required by the
   * server, its reason posted as chosen with no validator of this form's own.
   */
  readonly withdrawForm = new FormGroup({
    withdrawalDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    withdrawalReasonId: new FormControl<SelectValue | null>(null),
  });

  /**
   * The reactivation form: `POST /clients/{id}?command=reactivate`.
   *
   * It carries a date because the command requires one: `ClientActionRequest`'s `reactivate` variant
   * declares `reactivationDate`, the fork validates that member with `notNull`, and the legacy screen
   * renders the field under `label.input.reactivationdate` and posts it — so a confirm-only screen
   * would send a body the server refuses. It starts empty: a reactivation date is not one of the
   * defaults AAP 0.10.5 item 15 lists, and inventing one would be an improvement the legacy screen
   * does not make (Rule 1 clause 3).
   */
  readonly reactivateForm = new FormGroup({
    reactivationDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
  });

  /**
   * Duplicate-submission protection for the primary button: `busy()` disables it while the command
   * is in flight, and a re-entrant click is refused rather than queued, so one click posts once.
   */
  readonly guard = createSubmitGuard();

  /**
   * The current command's copy, or `null` before the route resolved and for an unknown segment.
   * Every label below reads it, so all four agree with the command the form is bound to.
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
   * Reason-select key of the current command, empty for `activate` and `reactivate`: the template
   * renders the select from this, so a command that takes no reason cannot show an empty picker.
   */
  readonly reasonLabelKey = computed<string>(() => this.copy()?.reasonLabelKey ?? '');

  /**
   * Reads the route's two segments and drives the screen's one load sequence.
   *
   * One subscription is the whole entry point — never `snapshot` beside a subscription — so the gate
   * runs once per navigation and never twice for one screen load. It stays open for the life of the
   * instance rather than taking the first emission: Angular reuses this component when the URL moves
   * from one action to another on the same route, and a single-emission subscription would leave the
   * first command's form on screen for the second command's URL.
   */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        void this.load(params);
      });
  }

  /**
   * Posts the current command, once.
   *
   * It does nothing until the screen is ready, marks the current form's controls as touched so an
   * empty field shows the help block the shared fields render, and returns before issuing a request
   * when the form is invalid. Only the action date carries a validator, because only the date is
   * something Fineract states and legacy blocks on; the reason travels as the user chose it, including
   * none, and the server's own refusal is what reaches the screen (Rule 1 clause 3; AAP 0.7.4).
   * Otherwise it hands the command's own fields to {@link send}, which formats nothing and adds no
   * date format of its own.
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

        // The select writes its option's id, which the reason list sends as a number. A reason is
        // spread into the body only when one was chosen, so a tenant whose narration list is empty
        // still posts the action and Fineract's own refusal reaches the screen, as legacy's
        // unvalidated select allows (Rule 1 clause 3; AAP 0.7.4).
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

        // Conditional for the same reason as the closure branch above: no chosen reason means no
        // member, never a placeholder `null` id the server would read as a choice.
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

        // Conditional for the same reason as the closure branch above.
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
   * Runs the load sequence for the route's parameters, in the order the legacy controller runs it.
   *
   * An `:id` or `:action` the route does not carry, or an `:action` outside the five commands, stops
   * here with the not-found message and no request at all. Otherwise the gate runs and is awaited
   * first; a failed gate reports its message and stops before the reason list is read, so the form is
   * never rendered for a client whose checks did not answer. Only `close`, `reject` and `withdraw`
   * then read their reason list, and `ready` becomes true once everything the form needs is in hand.
   *
   * @param params the route's parameter map.
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
   * Posts one command through the submit guard and returns to the client record on success.
   *
   * The guarded callback clears the previous failure so a retry does not show a stale message while
   * it is in flight, hands the command's own fields to `ClientService.action`, which supplies
   * `dateFormat` and `locale` from the configuration at the boundary, and awaits the one POST. On
   * success the screen navigates to `#/viewclient/:id` with the route's own client id, as the legacy
   * controller does. On failure it records the mapped message verbatim and keeps every entered value,
   * so the user can correct the field the server named; the guard releases the button in either
   * outcome.
   *
   * @param command the command being posted, which is the one the body describes.
   * @param fields that command's own fields, as its form holds them; the date-format pair is not one
   * of them, because the service adds it from the configuration.
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
