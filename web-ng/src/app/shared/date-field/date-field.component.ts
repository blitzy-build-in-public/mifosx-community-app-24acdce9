import { ChangeDetectionStrategy, Component, Directive, ElementRef, forwardRef, inject, input, } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule, } from '@angular/forms';

import { fromCalendarParts } from '../date-format.util';

let nextDateFieldId = 0;

/** Formats a control's `Date` as the `yyyy-MM-dd` string an `<input type="date">` reads and writes. */
function toInputValue(value: Date | null): string {
  if (value === null) {
    return '';
  }
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses the `yyyy-MM-dd` string an `<input type="date">` reports into a `Date` at **local** midnight, or `null` when the element holds no date or names a day no calendar holds. */
function parseInputValue(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match;
  return fromCalendarParts(Number(year), Number(month), Number(day));
}

/** `ControlValueAccessor` that lets a native `<input type="date">` carry a `Date | null` instead of the `yyyy-MM-dd` string the browser stores. */
@Directive({
  selector: 'input[type=date][appDateValue]', providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputValueAccessor), multi: true }, ], host: {
    '(input)': 'handleInput()', '(change)': 'handleInput()', '(blur)': 'handleBlur()', }, })
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
  /** Disables or re-enables the element. This is the only route to the design's `disabled` state: the component declares no `disabled` input and the template binds no `disabled` attribute, because a second writer of the same property would fight this one. */
  setDisabledState(isDisabled: boolean): void {
    this.host.nativeElement.disabled = isDisabled;
  }
  /** Reports the element's current value to the form. Reading the host's own `value` keeps this free of an event cast, and calling `onChange` is what marks the control dirty — no `markAsDirty` call belongs here. */
  protected handleInput(): void {
    this.onChange(parseInputValue(this.host.nativeElement.value));
  }
  /** Reports the element as touched; the form's touched state drives the `.has-error` display. */
  protected handleBlur(): void {
    this.onTouched();
  }
}

/** Native date control that replaces the legacy jQuery datepicker, which the new application may not load (AAP 0.2.3 component inventory row `DateField`; AAP 0.5.4 gaps inventory row "Date picker") (AAP 0.10.5, AAP 0.14.1, AAP 0.4.4, Rule 1 clause 3). */
@Component({
  selector: 'app-date-field', imports: [ReactiveFormsModule, DateInputValueAccessor], templateUrl: './date-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, })
export class DateFieldComponent {
  /** The form control this field edits; its value is a `Date` at local midnight, or `null`. */
  readonly control = input.required<FormControl<Date | null>>();
  /** Visible label text, already translated by the parent; empty renders no label element. */
  readonly label = input<string>('');
  /** Accessible name for a field that renders no visible label, already translated by the parent; empty renders no attribute. */
  readonly ariaLabel = input<string>('');
  /** Marks the label as required for display and assistive technology; adds no validator. */
  readonly required = input(false);
  /** Id shared by the input and its label; defaults to a per-instance `date-field-N`. */
  readonly inputId = input<string>(`date-field-${nextDateFieldId++}`);
}
