import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProfileCardComponent, type ProfileCardField } from './profile-card.component';

/** Behavioural spec for the client record's profile card — the `ProfileCard` row of the component inventory, whose states are "with values, with empty values" (AAP 0.2.3). */
/** Heading the parent renders, standing for the client's display name. */
const DISPLAY_NAME = 'Spec Card Holder';
/** Rows in the order the parent supplies them, the last carrying no value: the design shows such a row, and AAP 0.7.4 fixes how it renders. */
const FIELDS: readonly ProfileCardField[] = [
  { label: 'Client Number', value: '123456789' },
  { label: 'External ID', value: 'EXT-0001' },
  { label: 'Staff', value: '' },
];
/** The label of the row above that carries no value. */
const EMPTY_VALUE_LABEL = 'Staff';
/** Text a missing value must never be replaced with, checked against the card's whole rendered text and not only the one value cell: the design shows a label with nothing beside it. */
const STAND_IN_TEXT: readonly string[] = ['N/A', '—', '–', 'null', 'undefined'];
/** A dash alone, the stand-in a reader would mistake for a value; the empty cell carries none. */
const LONE_DASH = /^[-–—]+$/;
/** Copy of the client sub-features the plan keeps out of scope: the signature link and the avatar upload and camera overlay buttons the design draws over this card (AAP 0.10.5 item 7). */
const OUT_OF_SCOPE_TEXT: readonly string[] = ['View Client Signature', 'Signature', 'Upload', 'Camera',];
/** Legacy key of the sub-heading the design places beneath the label/value rows (`label.heading.performancehistory`), and the label this spec serves for it. */
const SUBHEADING_KEY = 'label.heading.performancehistory';
const SUBHEADING_LABEL = 'Performance History';
/** Figma provenance of every expectation below: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"). */
describe('ProfileCardComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ProfileCardComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;
  beforeEach(async () => {
    // The card's sub-heading is a legacy translated label, so the spec provides the translate service and serves that one key in memory.
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

    // The card title is an `h2`, one level under the record header's `h1`, with `.panel-title` still
    // carrying the 18px/700 card-title box.
    const heading = host(fixture).querySelector('h2.panel-title');

    expect(heading?.textContent?.trim()).toBe(DISPLAY_NAME);
    expect(host(fixture).querySelector('h4.panel-title')).toBeNull();
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
    const cardText = host(fixture).textContent ?? '';
    expect(emptyRow).toBeDefined();
    expect(valueCell?.textContent?.trim()).toBe('');
    expect(valueCell?.textContent?.trim()).not.toMatch(LONE_DASH);
    for (const standIn of STAND_IN_TEXT) { expect(cardText.toLowerCase()).not.toContain(standIn.toLowerCase()); }
  });
  it('is the bordered panel the record screen gives it', () => {
    const fixture = createCard();
    const panel = host(fixture).querySelector('.panel');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('panel-bordered')).toBe(true);
  });
  it('renders the performance-history sub-heading as its label, never as a raw translation key', () => {
    const fixture = createCard();

    // An `h3` one level under the card title, with Bootstrap's own `.h5` alias keeping the 14px box
    // the `h5` element carried, so the outline never skips a level and no pixel moves.
    const subheading = host(fixture).querySelector('h3.h5');

    const text = subheading?.textContent?.trim() ?? '';
    expect(subheading).not.toBeNull();
    expect(host(fixture).querySelector('h5')).toBeNull();
    expect(text).toBe(SUBHEADING_LABEL);
    expect(text).not.toContain(SUBHEADING_KEY);
  });
  it('renders the avatar as decoration served from the legacy image tree', () => {
    const fixture = createCard();
    const avatar = host(fixture).querySelector('img.img-responsive');
    expect(host(fixture).querySelectorAll('img')).toHaveLength(1);
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute('alt')).toBe('');
    // The attribute as written, not the resolved `.src`: the path is served in place from the legacy image tree, so a rewrite here would point the card at an asset the build never serves.
    expect(avatar?.getAttribute('src')).toBe('images/client-image-placeholder.png');
  });
  it('carries no control of the out-of-scope signature, avatar-upload or camera features', () => {
    const fixture = createCard();
    const card = host(fixture);
    const cardText = (card.textContent ?? '').toLowerCase();
    // The card holds no button, link, file input or capture attribute at all: the two overlay buttons and the signature link the design draws here are out-of-scope client sub-features (AAP 0.10.5 item 7).
    expect(card.querySelectorAll('button, a, input[type="file"], [capture]')).toHaveLength(0);
    expect(card.querySelectorAll('img')).toHaveLength(1);
    for (const outOfScope of OUT_OF_SCOPE_TEXT) { expect(cardText).not.toContain(outOfScope.toLowerCase()); }
  });
  it('gives a row carrying a value the same structure as a row carrying none', () => {
    const fixture = createCard();
    const populated = rows(fixture)[0];
    expect(cellText(populated, 'profile-field-label')).toBe(FIELDS[0].label);
    expect(cellText(populated, 'profile-field-value')).toBe(FIELDS[0].value);
    expect(
      populated.querySelector('[data-testid="profile-field-label"]')?.classList.contains('value-key'),
    ).toBe(true);
    for (const row of rows(fixture)) {
      expect(row.querySelectorAll('[data-testid="profile-field-label"]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-testid="profile-field-value"]')).toHaveLength(1);
    }
  });
  it('renders the heading and no rows at all when there are no fields', () => {
    const fixture = createCard(DISPLAY_NAME, []);
    expect(host(fixture).querySelector('h2.panel-title')?.textContent?.trim()).toBe(DISPLAY_NAME);
    expect(rows(fixture)).toHaveLength(0);
  });
  it('renders the history rows under the sub-heading, each beside an empty value cell', () => {
    const fixture = createCard();
    const history: readonly ProfileCardField[] = [
      { label: 'No. of Loan Cycle', value: '' },
      { label: 'No. of Active Loans', value: '' },
    ];
    fixture.componentRef.setInput('historyFields', history);
    fixture.detectChanges();
    const rendered = Array.from(
      host(fixture).querySelectorAll<HTMLElement>('[data-testid="profile-history-field"]'),
    ).map((row) => [cellText(row, 'profile-history-field-label'), cellText(row, 'profile-history-field-value'),]);
    expect(rendered).toEqual([['No. of Loan Cycle', ''], ['No. of Active Loans', ''],]);
    // They belong beneath the sub-heading, which is where legacy's record paints them.
    const subheading = host(fixture).querySelector('h3.h5');
    const firstHistory = host(fixture).querySelector('[data-testid="profile-history-field"]');
    const followsSubheading =
      subheading !== null && firstHistory !== null &&
      (subheading.compareDocumentPosition(firstHistory) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(followsSubheading).toBe(true);
  });
  it('renders no history row when the parent supplies none', () => {
    const fixture = createCard();
    expect(host(fixture).querySelectorAll('[data-testid="profile-history-field"]')).toHaveLength(0);
  });
});
