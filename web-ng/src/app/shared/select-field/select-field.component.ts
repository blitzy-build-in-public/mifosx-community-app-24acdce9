import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

/** One selectable option, exactly as a Fineract `template` endpoint returns it (AAP 0.4.3): `officeOptions`, `staffOptions`, `productOptions`, `chargeOptions`, `paymentTypeOptions` and the close/reject/withdraw reason lists all arrive in this shape. */
export interface SelectOption {
  /** Option identifier, kept as the number or string the template sent so the posting service builds the same JSON body the legacy screen builds (Rule 1 clause 2). */
  readonly id: number | string;
  /** Option label as the template returned it, rendered unchanged and in the received order. */
  readonly name: string;
}

/** The value a `SelectFieldComponent` writes to its caller's control: the chosen option's `id` with its runtime type intact, never a stringified copy of it (Rule 1 clause 2). */
export type SelectValue = number | string;

/** Instance counter behind the default `inputId`, so every select rendered on one screen has an element id of its own without a feature template having to supply one. */
let nextInputId = 0;

/** Builds the next default element id. Module-private: it is not part of the contract. */
const nextSelectFieldId = (): string => `select-field-${++nextInputId}`;

/** Native `<select>` bound to a caller-owned `FormControl` — the replacement for the legacy application's jQuery `chosen` plugin (AAP 0.7.1 shared row `SelectFieldComponent`, AAP 0.2.3 row `SelectField`, AAP 0.5.2 row `Dropdowns / selects` — GAP: legacy used chosen; the request's own harness assumes native selects — resolved in AAP 0.5.4, Rule 1 clause 3, AAP 0.4.4). */
@Component({
  selector: 'app-select-field', imports: [ReactiveFormsModule], templateUrl: './select-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, })
export class SelectFieldComponent {
  /** Options straight from the Fineract template response, rendered in its order. */
  readonly options = input.required<readonly SelectOption[]>();
  /** The caller's control, which owns the value, the validators and the serialisation of the chosen id into a request body; this component never constructs, resets, validates or subscribes to it, and disabled state is `control().disable()`, not an input. */
  readonly control = input.required<FormControl<SelectValue | null>>();
  /** Already-translated text of the leading empty-valued option, which the template renders only when non-empty; `''` means no placeholder option, never an empty-string option. */
  readonly placeholder = input<string>('');
  /** Already-translated `.control-label` text, rendered only when non-empty; translation stays in the feature template, so this component imports no i18n service. */
  readonly label = input<string>('');
  /** Accessible name for a field that renders no visible label, already translated by the parent; `''` renders no attribute, and the template emits it only while no `<label>` renders, so a visible label always supplies the name itself and is never overridden (WCAG label in name). */
  readonly ariaLabel = input<string>('');
  /** Sets `aria-required` for assistive technology and is deliberately not the native `required` attribute: the browser would then block submission before Fineract sees the request, which is client-side validation the legacy form does not perform (Rule 1 clause 3). */
  readonly required = input<boolean>(false);
  /** Id of the `<select>` and of the label's `for`, defaulting to a unique `select-field-<n>`; a caller-supplied id always wins. */
  readonly inputId = input<string>(nextSelectFieldId());
  /** Reports the value the caller's control holds once the user picks a row: the chosen option's `id` with its runtime type intact, or `null` when the prompt row is chosen (AAP 0.2.3 row `SelectField`). */
  readonly valueChange = output<SelectValue | null>();
  /** Publishes the selection the caller's control now holds when the user picks a row: the value is read from that control, never from the event, because `[formControl]` on this same `<select>` installs `SelectControlValueAccessor`, whose own `change` listener writes the control before this one runs, and an option's DOM value is `[ngValue]`'s positional key rather than the id a request body carries. */
  protected emitSelection(): void {
    this.valueChange.emit(this.control().value);
  }
}
