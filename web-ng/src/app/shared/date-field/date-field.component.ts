import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  forwardRef,
  inject,
  input,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';

import { fromCalendarParts } from '../date-format.util';

/**
 * Source of the per-instance default for `DateFieldComponent.inputId`. The initialiser runs once per
 * component instance, so each field in a form gets its own `date-field-0`, `date-field-1`, … id and
 * every `<label for>` points at exactly one control, with no two fields sharing an id when several
 * appear on one screen. A caller with a meaningful id of its own (a form field it wants addressable)
 * binds `inputId` and the generated one is simply unused.
 */
let nextDateFieldId = 0;

/**
 * Formats a control's `Date` as the `yyyy-MM-dd` string an `<input type="date">` reads and writes.
 *
 * The value is built from the date's **local** calendar fields, never from
 * `toISOString().slice(0, 10)`: that converts to UTC and moves the day backwards for every
 * timezone west of Greenwich, which would silently show and post a different date than the one
 * the user picked. `null` renders the empty string, the only value the element treats as "no
 * date chosen".
 */
function toInputValue(value: Date | null): string {
  if (value === null) {
    return '';
  }
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses the `yyyy-MM-dd` string an `<input type="date">` reports into a `Date` at **local**
 * midnight, or `null` when the element holds no date or names a day no calendar holds.
 *
 * The parts are read individually and handed to the shared local-midnight builder, which interprets
 * them in the browser's timezone. `Date.parse('2026-11-22')` would instead be read as UTC midnight
 * and, west of Greenwich, land on the previous local day — the same shift `toInputValue` avoids.
 * Anything that is not a complete `yyyy-MM-dd` value yields `null` rather than an `Invalid Date`
 * reaching a form control.
 *
 * The calendar check is `fromCalendarParts` from `shared/date-format.util.ts`, shared rather than
 * copied so this parser and `fromFineractDate` answer alike: a value naming a day no calendar holds
 * yields `null`, where `new Date(2026, 1, 30)` would roll it forward to 2 March and the control
 * would report a date the user never entered.
 */
function parseInputValue(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match;
  return fromCalendarParts(Number(year), Number(month), Number(day));
}

/**
 * `ControlValueAccessor` that lets a native `<input type="date">` carry a `Date | null` instead of
 * the `yyyy-MM-dd` string the browser stores.
 *
 * `@angular/forms` ships no accessor for date inputs — its only accessors are the default, checkbox,
 * number, range, radio and the two select ones — so a plain `[formControl]` on a date input writes a
 * string into the control, emits `''` rather than `null` when the user clears it, and cannot display
 * a `Date` handed to it by `setValue`. This directive closes that gap on the element itself: it is a
 * second non-default accessor, which `NgControl` prefers over the built-in one, and it converts in
 * local time in both directions so the day the user sees is the day the form holds.
 *
 * Applied by `DateFieldComponent`'s template to its own `<input type="date">`; it is not meant to be
 * attached elsewhere, and `[formControl]` on that element is what drives it.
 */
@Directive({
  selector: 'input[type=date][appDateValue]',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputValueAccessor), multi: true },
  ],
  host: {
    '(input)': 'handleInput()',
    '(change)': 'handleInput()',
    '(blur)': 'handleBlur()',
  },
})
export class DateInputValueAccessor implements ControlValueAccessor {
  private readonly host = inject<ElementRef<HTMLInputElement>>(ElementRef);

  private onChange: (value: Date | null) => void = () => {};

  private onTouched: () => void = () => {};

  /** Shows the control's value in the element; `null` clears it to the empty string. */
  writeValue(value: Date | null): void {
    this.host.nativeElement.value = toInputValue(value);
  }

  /** Stores the callback the element reports user edits through. */
  registerOnChange(fn: (value: Date | null) => void): void {
    this.onChange = fn;
  }

  /** Stores the callback the element reports a touch through. */
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  /**
   * Disables or re-enables the element. This is the only route to the design's `disabled` state: the
   * component declares no `disabled` input and the template binds no `disabled` attribute, because a
   * second writer of the same property would fight this one.
   */
  setDisabledState(isDisabled: boolean): void {
    this.host.nativeElement.disabled = isDisabled;
  }

  /**
   * Reports the element's current value to the form. Reading the host's own `value` keeps this free
   * of an event cast, and calling `onChange` is what marks the control dirty — no `markAsDirty` call
   * belongs here.
   */
  protected handleInput(): void {
    this.onChange(parseInputValue(this.host.nativeElement.value));
  }

  /** Reports the element as touched; the form's touched state drives the `.has-error` display. */
  protected handleBlur(): void {
    this.onTouched();
  }
}

/**
 * Native date control that replaces the legacy jQuery datepicker, which the new application may not
 * load (AAP 0.2.3 component inventory row `DateField`; AAP 0.5.4 gaps inventory row "Date picker").
 *
 * Its template carries the legacy Bootstrap 3 form markup and this file declares no styles, so the
 * label, the native control and the invalid state are styled by the global
 * `input[type="date"].form-control` and `.has-error` rules alone, with `.control-label` left to
 * Bootstrap's own declaration exactly as the legacy screens leave it. The value is carried as
 * `Date | null` through `DateInputValueAccessor`. It is the only intended difference from the legacy
 * screens (AAP 0.10.5 item 1): payloads still go out with `dateFormat: 'dd MMMM yyyy'` and the active
 * `locale`, because serialising belongs to the owning feature service and never to this control
 * (AAP 0.14.1), and the browser's own picker supplies the interaction the jQuery plugin did.
 *
 * The five inputs are:
 * - `control` (required) — the `FormControl<Date | null>` the template binds with `[formControl]`.
 * - `label` — the visible label text, already translated by the parent; empty renders no label.
 * - `ariaLabel` — the accessible name for a field that renders no visible label, already translated by
 *   the parent; empty renders no attribute. It is used only while no `<label>` renders, so a visible
 *   label always supplies the name itself (WCAG label in name).
 * - `required` — a display and accessibility concern only. It marks the label, it does not add a
 *   `Validator` or a `required` attribute, because the only validation this application applies is
 *   the one Fineract itself reports (AAP 0.4.4 behavioural inheritance, Rule 1 clause 3).
 * - `inputId` — id shared by the `<input>` and its `<label for>`, defaulting to a per-instance
 *   `date-field-N`.
 *
 * It ships no stylesheet: the global rules for `input[type="date"].form-control` in
 * `web-ng/src/styles.scss` give the control its 34px height, 1px `#E0E0E0` border and 2px radius, and
 * Bootstrap 3 supplies `.control-label`, `.has-error` and `.help-block`. That keeps every value
 * resolving to the legacy design system instead of a colour or pixel literal in a component
 * (Rule 1 clause 6, AAP 0.5.2).
 */
@Component({
  selector: 'app-date-field',
  imports: [ReactiveFormsModule, DateInputValueAccessor],
  templateUrl: './date-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateFieldComponent {
  /** The form control this field edits; its value is a `Date` at local midnight, or `null`. */
  readonly control = input.required<FormControl<Date | null>>();

  /** Visible label text, already translated by the parent; empty renders no label element. */
  readonly label = input<string>('');

  /** Accessible name for a field that renders no visible label, already translated by the parent;
   *  empty renders no attribute. The template emits it only while no `<label>` renders, so a visible
   *  label always supplies the name itself and is never overridden (WCAG label in name). */
  readonly ariaLabel = input<string>('');

  /** Marks the label as required for display and assistive technology; adds no validator. */
  readonly required = input(false);

  /** Id shared by the input and its label; defaults to a per-instance `date-field-N`. */
  readonly inputId = input<string>(`date-field-${nextDateFieldId++}`);
}
