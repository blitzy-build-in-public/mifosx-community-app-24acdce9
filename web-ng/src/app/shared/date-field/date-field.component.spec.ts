import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { DateFieldComponent } from './date-field.component';

/** Behavioural spec for `DateFieldComponent`, the native control that replaces the legacy jQuery datepicker (AAP 0.2.3 component inventory row `DateField`; AAP 0.5.4 gaps inventory row "Date picker"; AAP 0.10.5 item 1) (Rule 1 clause 3, AAP 0.4.4, Rule 1 clause 4). */

/** The root form group, or a named failure when the template rendered none. */
function formGroupOf(fixture: ComponentFixture<DateFieldComponent>): HTMLElement {
  const element: unknown = fixture.nativeElement.querySelector('.form-group');
  if (!(element instanceof HTMLElement)) {
    throw new Error('DateFieldComponent rendered no .form-group root');
  }
  return element;
}

/** The native date control, or a named failure when the template rendered none. */
function dateInputOf(fixture: ComponentFixture<DateFieldComponent>): HTMLInputElement {
  const element: unknown = fixture.nativeElement.querySelector('input[type="date"]');
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('DateFieldComponent rendered no input[type="date"]');
  }
  return element;
}

/** The label, or a named failure when the template rendered none. */
function labelOf(fixture: ComponentFixture<DateFieldComponent>): HTMLLabelElement {
  const element: unknown = fixture.nativeElement.querySelector('.control-label');
  if (!(element instanceof HTMLLabelElement)) {
    throw new Error('DateFieldComponent rendered no .control-label');
  }
  return element;
}

/** The control's value, or a named failure when it is not the `Date` the accessor promises. */
function dateValueOf(control: FormControl<Date | null>): Date {
  const value = control.value;
  if (!(value instanceof Date)) {
    throw new Error('the control does not hold a Date');
  }
  return value;
}

/** An invalid, empty control of the kind a parent form owns: the field itself never adds a validator (it only displays the verdict), so the spec supplies the one that makes the control invalid. Errors set by hand with `setErrors` would not survive the binding, because Angular revalidates the control when the `[formControl]` input is first set up. */
function invalidControl(): FormControl<Date | null> {
  return new FormControl<Date | null>(null, Validators.required);
}

describe('DateFieldComponent', () => {
  let fixture: ComponentFixture<DateFieldComponent>;
  let control: FormControl<Date | null>;

  /** The date input of the fixture each test starts with. */
  const dateInput = (): HTMLInputElement => dateInputOf(fixture);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DateFieldComponent] }).compileComponents();

    control = new FormControl<Date | null>(null);
    fixture = TestBed.createComponent(DateFieldComponent);
    // `control` is a required input, so it is bound before the first change detection runs.
    fixture.componentRef.setInput('control', control);
  });

  it('renders one Bootstrap form group holding exactly one native date input', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.form-group')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('input')).toHaveLength(1);
    expect(dateInput().getAttribute('type')).toBe('date');
    expect(dateInput().classList.contains('form-control')).toBe(true);
    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(false);
  });

  it('adds no stylesheet and no inline style of its own', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('style')).toBeNull();
    expect(formGroupOf(fixture).hasAttribute('style')).toBe(false);
    expect(dateInput().hasAttribute('style')).toBe(false);
  });

  it('shows the control value as the yyyy-MM-dd string the element reads', () => {
    fixture.detectChanges();
    expect(dateInput().value).toBe('');

    control.setValue(new Date(2026, 10, 21));
    fixture.detectChanges();
    expect(dateInput().value).toBe('2026-11-21');

    control.setValue(null);
    fixture.detectChanges();
    expect(dateInput().value).toBe('');
  });

  it('writes a picked date back as a Date at local midnight and marks the control dirty', () => {
    fixture.detectChanges();

    const input = dateInput();
    input.value = '2026-11-05';
    input.dispatchEvent(new Event('input'));

    // Read through the local calendar fields: `toISOString` converts to UTC and moves the day backwards in every timezone west of Greenwich, hiding exactly the bug the accessor prevents.
    const picked = dateValueOf(control);
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(10);
    expect(picked.getDate()).toBe(5);
    expect(control.dirty).toBe(true);
    expect(control.touched).toBe(false);
  });

  it('writes null, not the empty string, when the field is cleared', () => {
    fixture.detectChanges();

    const input = dateInput();
    input.value = '2026-11-05';
    input.dispatchEvent(new Event('input'));
    expect(dateValueOf(control).getDate()).toBe(5);

    input.value = '';
    input.dispatchEvent(new Event('input'));

    expect(control.value).toBeNull();
  });

  it('reports null, never a rolled-forward day, for a value no calendar holds', () => {
    fixture.detectChanges();

    const input = dateInput();
    // A conforming `input[type=date]` sanitises '2026-02-30' to the empty string, so the parser can only be reached with it programmatically: assigning `input.value` would be sanitised away, so the element's own `value` property is redefined before the event is dispatched.
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: '2026-02-30', });
    input.dispatchEvent(new Event('input'));

    expect(control.value).toBeNull();

    // The same path still takes a day that exists, as that local-midnight `Date`, so the assertion above cannot pass by rejecting every value the element reports.
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: '2026-11-05', });
    input.dispatchEvent(new Event('input'));

    const picked = dateValueOf(control);
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(10);
    expect(picked.getDate()).toBe(5);
    expect(picked.getHours()).toBe(0);
  });

  it('marks the control touched when the field loses focus', () => {
    fixture.detectChanges();
    expect(control.touched).toBe(false);

    dateInput().dispatchEvent(new Event('blur'));

    expect(control.touched).toBe(true);
  });

  it('adds no validator of its own to the control it edits, even when marked required', () => {
    fixture.detectChanges();
    expect(control.validator).toBeNull();

    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();

    expect(control.validator).toBeNull();
    expect(dateInput().getAttribute('aria-required')).toBe('true');
  });

  it('shows .has-error only once an invalid control is touched', () => {
    const invalid = invalidControl();
    fixture.componentRef.setInput('control', invalid);
    fixture.detectChanges();

    expect(invalid.invalid).toBe(true);
    expect(invalid.touched).toBe(false);
    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(false);
    expect(dateInput().hasAttribute('aria-invalid')).toBe(false);

    invalid.markAsTouched();
    fixture.detectChanges();

    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(true);
    expect(dateInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows .has-error for an invalid control the user has already edited', () => {
    const invalid = invalidControl();
    invalid.markAsDirty();
    fixture.componentRef.setInput('control', invalid);
    fixture.detectChanges();

    expect(invalid.touched).toBe(false);
    expect(invalid.dirty).toBe(true);
    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(true);
  });

  it('clears .has-error once the control becomes valid', () => {
    const invalid = invalidControl();
    fixture.componentRef.setInput('control', invalid);
    invalid.markAsTouched();
    fixture.detectChanges();
    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(true);

    invalid.setValue(new Date(2026, 10, 21));
    fixture.detectChanges();

    expect(invalid.invalid).toBe(false);
    expect(formGroupOf(fixture).classList.contains('has-error')).toBe(false);
    expect(dateInput().hasAttribute('aria-invalid')).toBe(false);
  });

  it('renders a label bound to the input id only when label text is supplied', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.control-label')).toBeNull();

    fixture.componentRef.setInput('label', 'Submitted on');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.control-label')).toHaveLength(1);
    expect(labelOf(fixture).textContent?.trim()).toBe('Submitted on');
    expect(labelOf(fixture).getAttribute('for')).toBe(dateInput().id);
  });

  /** The accessible-name rule, as the two name-bearing inputs vary: `ariaLabel` alone names the control, a visible `label` names it and suppresses the attribute (WCAG label in name, so a caller supplying both never overrides its own visible text), and neither supplied leaves the shipped legacy markup — an unnamed control with no attribute at all — exactly as it was. */
  const accessibleNameCases: readonly {
    readonly scenario: string;
    readonly label?: string;
    readonly ariaLabel?: string;
    readonly visibleLabel: boolean;
    readonly accessibleName: string | null;
  }[] = [{
      scenario: 'names the input from ariaLabel while rendering no visible label', ariaLabel: 'Submitted on', visibleLabel: false,
      accessibleName: 'Submitted on', }, {
      scenario: 'lets a visible label supply the name and renders no aria-label beside it', label: 'Submitted on',
      ariaLabel: 'Submission date', visibleLabel: true, accessibleName: null, }, {
      scenario: 'renders neither a label nor an aria-label when neither input is supplied', visibleLabel: false, accessibleName: null, }, ];

  it.each(accessibleNameCases)('$scenario', ({ label, ariaLabel, visibleLabel, accessibleName }) => {
    if (label !== undefined) {
      fixture.componentRef.setInput('label', label);
    }
    if (ariaLabel !== undefined) {
      fixture.componentRef.setInput('ariaLabel', ariaLabel);
    }
    fixture.detectChanges();

    const labels = fixture.nativeElement.querySelectorAll('.control-label');
    expect(labels).toHaveLength(visibleLabel ? 1 : 0);
    expect(dateInput().getAttribute('aria-label')).toBe(accessibleName);

    // A visible label is the name itself, so it still has to point at the control it names.
    if (visibleLabel) {
      expect(labelOf(fixture).getAttribute('for')).toBe(dateInput().id);
    }
  });

  it('exposes required to assistive technology without letting the browser block submission', () => {
    fixture.detectChanges();
    expect(dateInput().hasAttribute('aria-required')).toBe(false);

    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();

    expect(dateInput().getAttribute('aria-required')).toBe('true');
    // A native `required` would have the browser refuse a submission that only Fineract may judge.
    expect(dateInput().hasAttribute('required')).toBe(false);
  });

  it('takes the disabled state from the control alone', () => {
    fixture.detectChanges();
    // `disabled` is a reflected property, so both states are read through it: the template binds no disabled attribute, and the element stays enabled until the control itself disables it.
    expect(dateInput().disabled).toBe(false);

    control.disable();
    fixture.detectChanges();
    expect(dateInput().disabled).toBe(true);

    control.enable();
    fixture.detectChanges();
    expect(dateInput().disabled).toBe(false);
  });

  it('gives every field its own id and lets a caller override it', () => {
    fixture.detectChanges();
    const generatedId = dateInput().id;
    expect(generatedId).not.toBe('');

    const sibling = TestBed.createComponent(DateFieldComponent);
    sibling.componentRef.setInput('control', new FormControl<Date | null>(null));
    sibling.detectChanges();
    const siblingId = dateInputOf(sibling).id;
    sibling.destroy();

    expect(siblingId).not.toBe('');
    expect(siblingId).not.toBe(generatedId);

    fixture.componentRef.setInput('inputId', 'client-activation-date');
    fixture.componentRef.setInput('label', 'Activation date');
    fixture.detectChanges();

    expect(dateInput().id).toBe('client-activation-date');
    expect(labelOf(fixture).getAttribute('for')).toBe('client-activation-date');
  });
});
