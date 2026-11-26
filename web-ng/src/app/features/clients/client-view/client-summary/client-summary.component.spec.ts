import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MissingTranslationHandler, TranslateService, provideTranslateService, } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { FineractMissingTranslationHandler } from '../../../../core/i18n/missing-translation.handler';
import { toFineractDate } from '../../../../shared/date-format.util';
import type { Client } from '../../client.models';
import { ClientSummaryComponent } from './client-summary.component';

/** Behavioural spec for the client record's summary block: the `General` tab's label/value rows, fed by the one `GET /clients/{id}` response (AAP 0.7.1, AAP 0.7.4; workflow W3). */
/** Labels of the block's five rows, in render order: the four text rows in the template's loop followed by the date row the template writes out. The date row carries the profile card's own wording, `label.input.activationdate`, so one field has one label on the record (Rule 1 clause 3). */
const ROW_LABELS: readonly string[] = ['Client Number', 'External ID', 'Office', 'Staff', 'Activation date',];
/** The four legacy keys the template's loop binds, in the component's row order, asserted against `ClientSummaryRow.labelKey` so a row cannot lose its key and fall back to literal copy. */
const ROW_LABEL_KEYS: readonly string[] = [
  'label.heading.clientno',
  'label.input.externalid',
  'label.heading.office',
  'label.input.staff',
];
/** The wording the shipped `app/global-translations/locale-en.json` bundle carries for the five keys, served to `TranslateService` so the labels resolve in the spec exactly as they do on the record. Both activation-date keys are carried verbatim — `Activation Date` and `Activation date` — because their different wording is the only thing that shows which of the two the row binds, and the row must bind the profile card's `label.input.activationdate`. */
const EN_BUNDLE: Readonly<Record<string, string>> = {
  'label.heading.clientno': 'Client Number',
  'label.input.externalid': ' External ID',
  'label.heading.office': 'Office',
  'label.input.staff': 'Staff',
  'label.heading.activationdate': 'Activation Date',
  'label.input.activationdate': 'Activation date',
};
/** The wording the same bundle's French file carries for the same keys — what the language switcher must put on screen once `fr` is active, and what a label hardcoded in English could never render. */
const FR_BUNDLE: Readonly<Record<string, string>> = {
  'label.heading.clientno': 'Numéro de client',
  'label.input.externalid': 'Identifiant externe',
  'label.heading.office': 'Bureau',
  'label.input.staff': 'Équipe',
  'label.heading.activationdate': 'Date d’activation',
  'label.input.activationdate': 'Date d’activation',
};
/** Labels of the five rows in the language the switcher selects, in render order. */
const FR_ROW_LABELS: readonly string[] = [
  'Numéro de client',
  'Identifiant externe',
  'Bureau',
  'Équipe',
  'Date d’activation',
];
/** Zero-padded client number the design prints verbatim, held as text and never parsed. */
const ACCOUNT_NO = '000000002';
/** Bank-assigned external id of the activated fixture, obviously synthetic. */
const EXTERNAL_ID = 'EXT-0002';
/** Office the client is filed under, as the template returned it. */
const OFFICE_NAME = 'Head Office';
/** Loan officer of the activated fixture, a synthetic name rather than a real person's. */
const STAFF_NAME = 'Spec Officer';
/** Activation date in the wire form `Client.activationDate` carries: a `'yyyy-MM-dd'` string. */
const ACTIVATION_DATE_WIRE = '2026-11-21';
/** The same day as the local-midnight `Date` every display pattern is computed from: month index 10 is November. */
const ACTIVATION_DATE = new Date(2026, 10, 21);
/** The same day as the record renders it at `dd MMMM yyyy` in `en`, the pattern the design prints. */
const ACTIVATION_DATE_TEXT = '21 November 2026';
/** The same day at the same pattern in the language the switcher can select, French: the month name the row has to re-render, and the one a `DatePipe` bound to `LOCALE_ID` could never print (AAP 0.7.2 "Date handling"). */
const ACTIVATION_DATE_TEXT_FR = '21 novembre 2026';
/** A client with every field the block renders: the state four of the design's five rows show, and the only one whose activation date row carries a value. */
const ACTIVE_CLIENT: Client = {
  id: 2,
  accountNo: ACCOUNT_NO,
  externalId: EXTERNAL_ID,
  displayName: 'Spec Client',
  firstname: 'Spec',
  lastname: 'Client',
  officeId: 1,
  officeName: OFFICE_NAME,
  staffId: 7,
  staffName: STAFF_NAME,
  status: { id: 300, code: 'clientStatusType.active', value: 'Active' },
  activationDate: ACTIVATION_DATE_WIRE,
  timeline: { submittedOnDate: ACTIVATION_DATE_WIRE, activatedOnDate: ACTIVATION_DATE_WIRE },
};
/** A client the payload carries no external id, no staff assignment and no activation date for. */
const PENDING_CLIENT: Client = {
  id: 4,
  accountNo: '000000004',
  displayName: 'Spec Pending Client',
  firstname: 'Spec',
  lastname: 'Pending',
  officeId: 1,
  officeName: OFFICE_NAME,
  status: { id: 100, code: 'clientStatusType.pending', value: 'Pending' },
  timeline: {},
};
/** Text a missing value must never be replaced with, compared case-insensitively against every rendered cell: the record shows a label with nothing beside it. */
const STAND_IN_TEXT: readonly string[] = ['N/A', 'Not provided', 'Unassigned'];
/** A dash alone, the stand-in a reader would mistake for a value; the empty cells carry none. */
const LONE_DASH = /^[-–—]+$/;
/** Status words the record conveys through the header's dot and pill, and never through this block (AAP 0.10.5 deliberate difference 11). Checked in lower case over the block's whole text. */
const STATUS_TEXT: readonly string[] = ['active', 'pending', 'closed', 'rejected', 'withdrawn'];

describe('ClientSummaryComponent', () => {
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ClientSummaryComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;
  beforeEach(async () => {
    // The block is presentational, so the spec provides no HTTP client, no testing-controller double and no router: a render that needed any of them would throw here instead of passing. The one service the component reads is the app-wide `AppConfigService`, whose `activeLocale` issues no request and follows the translate provider configured below (AAP 0.7.2 "Date handling").
    await TestBed.configureTestingModule({
      imports: [ClientSummaryComponent],
      providers: [
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          missingTranslationHandler: {
            provide: MissingTranslationHandler,
            useClass: FineractMissingTranslationHandler,
          },
        }),
      ],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', EN_BUNDLE, true);
    translate.setTranslation('fr', FR_BUNDLE, true);
    translate.use('en');
  });
  /** Renders the block for `client`, with its only input set before the first change detection. */
  function createSummary(client: Client): ComponentFixture<ClientSummaryComponent> {
    const fixture = TestBed.createComponent(ClientSummaryComponent);
    fixture.componentRef.setInput('client', client);
    fixture.detectChanges();
    return fixture;
  }
  /** Trimmed text of every element `selector` matches, in document order. */
  function texts(fixture: ComponentFixture<ClientSummaryComponent>, selector: string): string[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>(selector)).map(
      (element) => element.textContent?.trim() ?? '',
    );
  }
  /** The block's label/value rows, in render order. */
  function rows(fixture: ComponentFixture<ClientSummaryComponent>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('.row'));
  }
  /** Labels of the bold key column, in render order. */
  function labels(fixture: ComponentFixture<ClientSummaryComponent>): string[] {
    return texts(fixture, '.value-key');
  }
  /** Values of the common value column, in render order. */
  function values(fixture: ComponentFixture<ClientSummaryComponent>): string[] {
    return texts(fixture, '.col-md-8');
  }
  it('renders the five summary rows in order, with the client’s own values', () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    expect(rows(fixture)).toHaveLength(ROW_LABELS.length);
    expect(labels(fixture)).toEqual(ROW_LABELS);
    expect(values(fixture)).toHaveLength(ROW_LABELS.length);
    expect(values(fixture).slice(0, 4)).toEqual([
      ACTIVE_CLIENT.accountNo,
      ACTIVE_CLIENT.externalId,
      ACTIVE_CLIENT.officeName,
      ACTIVE_CLIENT.staffName,
    ]);
  });
  it('renders the activation date at dd MMMM yyyy in the active locale, under the profile card’s own label', () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    const activationLabel = labels(fixture)[4];
    const activationCell = values(fixture)[4];
    // The row binds the key the profile card prints beside the same value, not the heading's longer wording, so one field carries one label on the record (Rule 1 clause 3).
    expect(activationLabel).toBe(EN_BUNDLE['label.input.activationdate']);
    expect(activationLabel).not.toBe(EN_BUNDLE['label.heading.activationdate']);
    // The cell is the shared util's `dd MMMM yyyy` string for the active locale — in `en` the pattern the design prints — and not a locale-defaulted `DatePipe` rendering of the `Date`, whose format string alone would leave the month name in `LOCALE_ID` (AAP 0.7.2 "Date handling").
    expect(activationCell).toBe(toFineractDate(ACTIVATION_DATE, 'en'));
    expect(activationCell).toBe(ACTIVATION_DATE_TEXT);
    // The rendered value is the display pattern, not the `'yyyy-MM-dd'` wire form the model holds.
    expect(activationCell).not.toContain(ACTIVATION_DATE_WIRE);
    expect(activationCell).not.toContain('GMT');
    expect(activationCell).not.toContain('T00:00');
  });
  it('re-renders the activation date in the language the switcher selects', async () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    const translate = TestBed.inject(TranslateService);
    expect(values(fixture)[4]).toBe(ACTIVATION_DATE_TEXT);
    translate.use('fr');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const localizedCell = values(fixture)[4];
    // The French month name at the same `dd MMMM yyyy` pattern: the row followed the switcher, where a `DatePipe` given only a format string would have gone on printing the injected locale's English month beside the translated profile card (AAP 0.7.2 "Date handling").
    expect(localizedCell).toBe(toFineractDate(ACTIVATION_DATE, 'fr'));
    expect(localizedCell).toBe(ACTIVATION_DATE_TEXT_FR);
    expect(localizedCell).not.toBe(ACTIVATION_DATE_TEXT);
    expect(labels(fixture)[4]).toBe(FR_BUNDLE['label.input.activationdate']);
  });
  it('re-words every label when the switcher activates another language', async () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    const translate = TestBed.inject(TranslateService);
    expect(fixture.componentInstance.rows().map((row) => row.labelKey)).toEqual(ROW_LABEL_KEYS);
    expect(labels(fixture)).toEqual(ROW_LABELS);
    translate.use('fr');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(labels(fixture)).toEqual(FR_ROW_LABELS);
  });
  it('renders a field the payload omits as an empty value, never a placeholder', () => {
    const fixture = createSummary(PENDING_CLIENT);
    const renderedValues = values(fixture);
    expect(labels(fixture)).toEqual(ROW_LABELS);
    expect(renderedValues[0]).toBe(PENDING_CLIENT.accountNo);
    expect(renderedValues[1]).toBe('');
    expect(renderedValues[2]).toBe(OFFICE_NAME);
    expect(renderedValues[3]).toBe('');
    expect(renderedValues[4]).toBe('');
    const renderedCells = [...labels(fixture),...renderedValues];
    for (const cell of renderedCells) {
      expect(cell).not.toMatch(LONE_DASH);
      for (const standIn of STAND_IN_TEXT) { expect(cell.toLowerCase()).not.toContain(standIn.toLowerCase()); }
    }
  });
  it('gives every row one label and one value cell, so all values share one column', () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    for (const row of rows(fixture)) {
      expect(row.querySelectorAll('.value-key')).toHaveLength(1);
      expect(row.querySelectorAll('.col-md-8')).toHaveLength(1);
    }
    expect(host(fixture).querySelectorAll('.col-md-4')).toHaveLength(ROW_LABELS.length);
  });
  it('names the stylesheet’s bold key-column class on every key cell', () => {
    const fixture = createSummary(ACTIVE_CLIENT);
    const keyCells = Array.from(host(fixture).querySelectorAll<HTMLElement>('.col-md-4 > span'),);
    expect(keyCells).toHaveLength(ROW_LABELS.length);
    for (const cell of keyCells) {
      // `.value-key` is the stylesheet's bold 14px key column (AAP 0.2.2 token `text-value-key`).
      expect(cell.classList).toContain('value-key');
      expect(cell.classList).not.toContain('control-label');
    }
  });
  it('renders no status word, leaving the record header’s dot and pill to carry the state', () => {
    const activeText = (host(createSummary(ACTIVE_CLIENT)).textContent ?? '').toLowerCase();
    const pendingText = (host(createSummary(PENDING_CLIENT)).textContent ?? '').toLowerCase();
    for (const statusWord of STATUS_TEXT) {
      expect(activeText).not.toContain(statusWord);
      expect(pendingText).not.toContain(statusWord);
    }
    expect(pendingText).not.toContain(PENDING_CLIENT.status.value.toLowerCase());
  });
  it('renders with no HTTP client, router or client-service provider configured', () => {
    const active = createSummary(ACTIVE_CLIENT);
    const pending = createSummary(PENDING_CLIENT);
    expect(rows(active)).toHaveLength(ROW_LABELS.length);
    expect(rows(pending)).toHaveLength(ROW_LABELS.length);
    expect(values(active)[4]).toBe(ACTIVATION_DATE_TEXT);
    expect(values(pending)[1]).toBe('');
  });
});
