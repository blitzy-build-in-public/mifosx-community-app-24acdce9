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
import { HasPermissionDirective } from '../../../shared/has-permission.directive';
import {
  SelectFieldComponent,
  type SelectOption,
  type SelectValue,
} from '../../../shared/select-field/select-field.component';
import { createSubmitGuard } from '../../../shared/submit-guard.util';
import type { ClientActionCommand } from '../client.models';
import { ClientService, type ClientActionInput } from '../client.service';

/** The copy one lifecycle command renders, as translation keys of the shipped legacy bundles rather than sentences (Rule 1 clause 6, AAP 0.10.2). */
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

/** The five commands' copy, keyed by the command itself. `satisfies Record<ClientActionCommand, ClientActionCopy>` is the point of the declaration: a command added to the union without copy, or copy left behind by a (Rule 1 clause 3). */
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

/** The permission code each lifecycle command is gated on, keyed by the command itself (AAP 0.1.1). */
export const CLIENT_ACTION_PERMISSIONS = {
  activate: 'ACTIVATE_CLIENT',
  close: 'CLOSE_CLIENT',
  reject: 'REJECT_CLIENT',
  withdraw: 'WITHDRAW_CLIENT',
  reactivate: 'REACTIVATE_CLIENT',
} satisfies Record<ClientActionCommand, string>;

/** The five in-scope commands as a lookup, so the `:action` segment can be validated against the `ClientActionCommand` union without a cast and without a list that could drift from it. */
const ACTION_COMMANDS = {
  activate: true,
  close: true,
  reject: true,
  withdraw: true,
  reactivate: true,
} satisfies Record<ClientActionCommand, true>;

/** Whether a raw `:action` segment is one of the five in-scope lifecycle commands. */
function isClientActionCommand(value: string): value is ClientActionCommand {
  return Object.hasOwn(ACTION_COMMANDS, value);
}

/** Today at local midnight: the activation date a new action screen starts on (Rule 1 clause 2, AAP 0.10.5, AAP 0.12). */
function todayAtLocalMidnight(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The text a failed call paints on this screen: Fineract's own message for a 4xx, and nothing for a failure the interceptor has already reported (AAP 0.4.4, AAP 0.7.4, Rule 1 clause 9). */
function failureMessage(error: unknown): string | null {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
    ? error.message
    : null;
}

/** The single-purpose form behind one client lifecycle action — `#/client/:id/:action` (AAP 0.8.2; AAP 0.7.1 Features row `clients`). **What it does, in the order legacy runs it.** It reads `:id` and `:action` from the (AAP 0.7.3, AAP 0.1.1, Rule 1 clause 3, AAP 0.3.4). */
@Component({
  selector: 'app-client-actions',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    DateFieldComponent,
    SelectFieldComponent,
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

  /** Which load is the current one, incremented by every emission of the route's parameters. */
  private loadSequence = 0;

  /** Id of the client the command applies to, as the `:id` segment delivered it. */
  readonly clientId = signal<string>('');

  /** The command in progress, or `null` before the route emitted and for an unknown segment. */
  readonly command = signal<ClientActionCommand | null>(null);

  /** Whether the gate — and, for a command that takes a reason, the reason list — has resolved. */
  readonly ready = signal(false);

  /** The one failure region, shared by a failed gate, a failed reason-list read and a failed command: Fineract's own message for a 4xx, verbatim and untranslated (AAP 0.4.4 decision 6; workflow W7) (AAP 0.7.4). */
  readonly error = signal<string | null>(null);

  /** Whether the `:action` segment names no in-scope command — `#/client/2/nonsense`, or a legacy action this migration does not deliver. */
  readonly notFound = signal(false);

  /** The reasons `close`, `reject` and `withdraw` offer, in the order the template returned them, and empty for a command that takes none or before the read resolves. */
  readonly reasonOptions = signal<readonly SelectOption[]>([]);

  /** Legacy key of the cancel button, which returns to the record without posting anything. */
  readonly cancelKey = 'label.button.cancel';

  /** Legacy key of the not-found heading, the same one the unknown-path screen renders. */
  readonly notFoundHeadingKey = 'label.heading.notavailable';

  /** Legacy key of the not-found sentence, worded as the platform words a missing resource. */
  readonly notFoundMessageKey = 'error.msg.resource.not.found';

  /** Legacy key of the empty row the reason select leads with, `label.select` ("Select an option"). */
  readonly reasonPlaceholderKey = 'label.select';

  /** The activation form: `POST /clients/{id}?command=activate`. The date is pre-filled with the browser's today, the default AAP 0.10.5 item 15 registers for an activation date, and it is the only control: `activate` takes (Rule 1 clause 3, AAP 0.4.4, AAP 0.7.2). */
  readonly activateForm = new FormGroup({
    activationDate: new FormControl<Date | null>(todayAtLocalMidnight(), {
      validators: [Validators.required],
    }),
  });

  /** The closure form: `POST /clients/{id}?command=close`. Its date starts empty, because AAP 0.10.5 item 15's browser-clock defaults name an activation date and not a closure, and the date is the form's only validated (Rule 1 clause 3, AAP 0.7.4). */
  readonly closeForm = new FormGroup({
    closureDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    closureReasonId: new FormControl<SelectValue | null>(null),
  });

  /** The rejection form: `POST /clients/{id}?command=reject`, its date empty and required by the server, its reason posted as chosen with no validator of this form's own. */
  readonly rejectForm = new FormGroup({
    rejectionDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    rejectionReasonId: new FormControl<SelectValue | null>(null),
  });

  /** The withdrawal form: `POST /clients/{id}?command=withdraw`, its date empty and required by the server, its reason posted as chosen with no validator of this form's own. */
  readonly withdrawForm = new FormGroup({
    withdrawalDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
    withdrawalReasonId: new FormControl<SelectValue | null>(null),
  });

  /** The reactivation form: `POST /clients/{id}?command=reactivate` (AAP 0.10.5, Rule 1 clause 3). */
  readonly reactivateForm = new FormGroup({
    reactivationDate: new FormControl<Date | null>(null, { validators: [Validators.required] }),
  });

  /** Duplicate-submission protection for the primary button: `busy()` disables it while the command is in flight, and a re-entrant click is refused rather than queued, so one click posts once. */
  readonly guard = createSubmitGuard();

  /** The current command's copy, or `null` before the route resolved and for an unknown segment. */
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

  /** Reason-select key of the current command, empty for `activate` and `reactivate`: the template renders the select from this, so a command that takes no reason cannot show an empty picker. */
  readonly reasonLabelKey = computed<string>(() => this.copy()?.reasonLabelKey ?? '');

  /** The code the current command's submit control is gated on, or `''` while the route names no command (AAP 0.1.1). */
  readonly actionPermission = computed<string>(() => {
    const command = this.command();

    return command === null ? '' : CLIENT_ACTION_PERMISSIONS[command];
  });

  /** Reads the route's two segments and drives the screen's one load sequence. */
  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params: ParamMap) => {
        void this.load(params);
      });
  }

  /** Posts the current command, once. It does nothing until the screen is ready, marks the current form's controls as touched so an empty field shows the help block the shared fields render, and returns before issuing a (Rule 1 clause 3, AAP 0.7.4). */
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

        // The select writes its option's id, which the reason list sends as a number (Rule 1 clause 3, AAP 0.7.4).
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

        // Conditional for the same reason as the closure branch above: no chosen reason means no member, never a placeholder `null` id the server would read as a choice.
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

  /** Runs the load sequence for the route's parameters, in the order the legacy controller runs it. */
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

  /** Posts one command through the submit guard and returns to the client record on success (AAP 0.7.4). */
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
