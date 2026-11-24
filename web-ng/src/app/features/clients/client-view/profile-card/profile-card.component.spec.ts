import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProfileCardComponent, type ProfileCardField } from './profile-card.component';

/**
 * Behavioural spec for the client record's profile card — the `ProfileCard` row of the component
 * inventory, whose states are "with values, with empty values" (AAP 0.2.3), and an element of the
 * client view screen (AAP 0.7.4), whose rule for a field that has no value it proves: the row
 * renders its label beside an empty value column rather than a placeholder.
 *
 * It serves AAP 0.11.1 (unit specs beside every component), AAP 0.14.1 ("each screen lands with at
 * least one behavioural spec") and AAP 0.14.2's "no spec without an `expect`".
 *
 * Every row below is synthetic display input: the component is presentational, so the spec never
 * needs a `Client` record, a service or a tenant value (Rule 1 clause 9).
 */

/** Heading the parent renders, standing for the client's display name. */
const DISPLAY_NAME = 'Spec Card Holder';

/**
 * Rows in the order the parent supplies them, the last carrying no value: the design shows such a
 * row, and AAP 0.7.4 fixes how it renders.
 */
const FIELDS: readonly ProfileCardField[] = [
  { label: 'Client Number', value: '123456789' },
  { label: 'External ID', value: 'EXT-0001' },
  { label: 'Staff', value: '' },
];

/** The label of the row above that carries no value. */
const EMPTY_VALUE_LABEL = 'Staff';

/** Text that would stand in for a missing value, none of which this card may render (AAP 0.7.4). */
const PLACEHOLDERS: readonly string[] = ['-', '—', 'N/A', 'n/a', 'None'];

/**
 * Legacy key of the sub-heading the design places beneath the label/value rows
 * (`label.heading.performancehistory`), and the label this spec serves for it.
 *
 * The card renders that label in one of two ways — resolved through the translate stack, or
 * carried as its English text — and the spec serves the same string the design shows, so the
 * assertion holds either way while still pinning that the user sees the label and never the raw
 * dotted key (AAP 0.10.2 "every label resolves", AAP 0.7.4).
 */
const SUBHEADING_KEY = 'label.heading.performancehistory';
const SUBHEADING_LABEL = 'Performance History';

describe('ProfileCardComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ProfileCardComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    // The card's sub-heading is a legacy translated label, so the spec provides the translate
    // stack the application runs with and serves that one key in memory: the assertion then holds
    // whether the card resolves the label or carries it as text, and neither may show the raw key.
    await TestBed.configureTestingModule({
      imports: [ProfileCardComponent],
      providers: [provideTranslateService()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);

    translate.setTranslation('en', { [SUBHEADING_KEY]: SUBHEADING_LABEL }, true);
    translate.use('en');
  });

  /** Renders the card with both required inputs set before the first change detection. */
  function createCard(
    displayName: string = DISPLAY_NAME,
    fields: readonly ProfileCardField[] = FIELDS,
  ): ComponentFixture<ProfileCardComponent> {
    const fixture = TestBed.createComponent(ProfileCardComponent);

    fixture.componentRef.setInput('displayName', displayName);
    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();

    return fixture;
  }

  /** The card's label/value rows, in render order. */
  function rows(fixture: ComponentFixture<ProfileCardComponent>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('[data-testid="profile-field"]'));
  }

  /** Text of the `data-testid` cell inside `row`, trimmed so template indentation cannot mislead. */
  function cellText(row: HTMLElement, testId: string): string | undefined {
    return row.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim();
  }

  it('renders the supplied display name as the card heading', () => {
    const fixture = createCard();

    expect(host(fixture).querySelector('h4.panel-title')?.textContent?.trim()).toBe(DISPLAY_NAME);
  });

  it('renders one row per field, in the order received, with its label and value', () => {
    const fixture = createCard();

    expect(rows(fixture)).toHaveLength(FIELDS.length);
    expect(rows(fixture).map((row) => cellText(row, 'profile-field-label'))).toEqual(
      FIELDS.map((field) => field.label),
    );
    expect(rows(fixture).map((row) => cellText(row, 'profile-field-value'))).toEqual(
      FIELDS.map((field) => field.value),
    );
  });

  it('renders a field with no value as its label beside an empty value cell, never a placeholder', () => {
    const fixture = createCard();
    const emptyRow = rows(fixture).find(
      (row) => cellText(row, 'profile-field-label') === EMPTY_VALUE_LABEL,
    );
    const valueCell = emptyRow?.querySelector('[data-testid="profile-field-value"]');

    expect(emptyRow).toBeDefined();
    expect(valueCell?.textContent).toBe('');

    for (const placeholder of PLACEHOLDERS) {
      expect(valueCell?.textContent).not.toContain(placeholder);
    }
  });

  it('is the bordered panel the record screen gives it', () => {
    const fixture = createCard();
    const panel = host(fixture).querySelector('.panel');

    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('panel-bordered')).toBe(true);
  });

  it('renders the performance-history sub-heading as its label, never as a raw translation key', () => {
    const fixture = createCard();
    const subheading = host(fixture).querySelector('h5');
    const text = subheading?.textContent?.trim() ?? '';

    expect(subheading).not.toBeNull();
    expect(text).toBe(SUBHEADING_LABEL);
    expect(text).not.toContain(SUBHEADING_KEY);
  });

  it('renders the avatar as decoration served from the legacy image tree', () => {
    const fixture = createCard();
    const avatar = host(fixture).querySelector('img.img-responsive');

    expect(avatar).not.toBeNull();
    // Decorative: the record's identity is carried by the heading, so the alt stays empty.
    expect(avatar?.getAttribute('alt')).toBe('');
    expect(avatar?.getAttribute('src')).toBe('images/client-image-placeholder.png');
  });

  it('renders the heading and no rows at all when there are no fields', () => {
    const fixture = createCard(DISPLAY_NAME, []);

    expect(host(fixture).querySelector('h4.panel-title')?.textContent?.trim()).toBe(DISPLAY_NAME);
    expect(rows(fixture)).toHaveLength(0);
  });
});
