import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  MissingTranslationHandler,
  TranslateService,
  provideTranslateService,
} from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FineractMissingTranslationHandler } from '../../../../core/i18n/missing-translation.handler';
import type { StatusKey } from '../../../../shared/status-swatch/status-swatch.component';
import type { Client, ClientStatus } from '../../client.models';
import { RecordHeaderComponent } from './record-header.component';

/**
 * Behavioural spec for the client record's header — the `RecordHeader` row of the component
 * inventory (AAP 0.2.3), the top block of the client view screen (AAP 0.7.4, Figma flow "Sign in
 * and open a client record", step 3 of 3, screen node `1:4`).
 *
 * It pins the five things the design draws and the migration must not add to:
 * - the status is the indicator's colour and nothing else — the dot holds no word, label, `title`
 *   or `aria-label`, and the server's own status `value` never reaches the screen
 *   (AAP 0.10.5 deliberate difference 11, Rule 1 clause 3);
 * - the client's name is the record's single title line, with the indicator on that same line;
 * - the metadata strip is exactly three `Key: value` runs in the design's order — client number,
 *   external id, staff — separated by two pipe glyphs, and a run the record leaves unset paints its
 *   key with an empty value rather than a placeholder (AAP 0.2.3 row `RecordHeader`, AAP 0.7.4);
 * - each label is the legacy bundle's own key resolved through `TranslatePipe`, so a language
 *   switch rewrites the strip and nothing here pins the English wording (Rule 1 clause 6,
 *   AAP 0.10.2);
 * - the header closes with one rule, carrying the stylesheet's `section-rule` class, and offers the
 *   user nothing to submit, so it can neither raise nor display an error.
 *
 * The component is presentational: it requests nothing, holds no state and formats nothing, so the
 * TestBed below registers no service, router or HTTP testing controller (AAP 0.14.1). The one thing
 * it does register is the translate stack, because every label resolves through `TranslatePipe` and
 * ngx-translate 18 declares `TranslateService` without `providedIn`, so the pipe's non-optional
 * injection fails without it: `provideTranslateService()` is the library's own registration, its
 * omitted loader slot defaults to the no-op loader so no bundle is ever requested, and the two
 * in-memory bundles below stand in for the shipped `locale-en.json` and a second locale. Every
 * assertion is made on the rendered DOM, never on the `protected` signals the
 * template reads, because the DOM is the contract the client view and the parity run observe
 * (Rule 1 clause 8).
 *
 * Figma provenance, read once for structure and never asserted on: the file `DKm5TBFbXypfqyx4xUdhBw`
 * holds the record only as a raster, so the design's dot-without-a-label, its single title line, its
 * empty value cell and its lack of a stand-in text are the structures these cases keep true. Sizes,
 * colours and font metrics belong to `web-ng/src/styles.scss` and appear nowhere here.
 */

/**
 * The client status codes this record can receive, paired with the indicator key each must paint,
 * taken verbatim from the fork's `ClientStatus` enum and from `toClientStatusKey`'s table in
 * `client.models.ts` — never invented here. `active`, `pending` and `closed` are the three named
 * states; `transfer.in.progress` is the representative of the codes the model maps to the neutral
 * key (AAP 0.2.3 row `StatusSwatch`).
 */
const STATUS_CASES: readonly (readonly [string, StatusKey])[] = [
  ['clientStatusType.active', 'active'],
  ['clientStatusType.pending', 'pending'],
  ['clientStatusType.closed', 'closed'],
  ['clientStatusType.transfer.in.progress', 'other'],
];

/**
 * The codes the model does not recognise, including the empty code a malformed payload could carry.
 * All of them must paint the neutral colour rather than claim a state (AAP 0.7.2 row `Client`).
 */
const UNMAPPED_CODES: readonly string[] = [
  'clientStatusType.invalid',
  'clientStatusType.transfer.on.hold',
  '',
];

/** The record's client number, the zero-padded display text the design prints verbatim. */
const ACCOUNT_NO = '000000002';

/** The record's external id, a value the header prints as received. */
const EXTERNAL_ID = 'CL-002';

/** The record's loan officer, the label the header prints as received. */
const STAFF_NAME = 'Parity Officer';

/**
 * The `status.value` a client response carries — the server's own English label for the state.
 *
 * It stands in for that label deliberately: the header paints a colour, so a rendered
 * `STATUS-VALUE-SENTINEL` anywhere would mean the word had leaked onto the screen
 * (AAP 0.10.5 deliberate difference 11, Rule 1 clause 3). Every fixture below defaults to it, so
 * each case also proves its absence.
 */
const STATUS_VALUE_SENTINEL = 'STATUS-VALUE-SENTINEL';

/**
 * Text a run with no value must never be filled in with. A dash or a stand-in would be the
 * improvement the migration may not make: the design paints the key and nothing after it
 * (AAP 0.7.4, Rule 1 clause 3).
 */
const STAND_IN_TEXT: readonly string[] = ['N/A', 'n/a', 'undefined', 'null', '-', '—'];

/**
 * The three labels the strip paints in English, in the design's order, each with the colon the
 * template appends. The wording is the shipped bundle's own: `app/global-translations/locale-en.json`
 * holds 'Client Number', ' External ID' (leading space and all) and 'Staff' for the three keys
 * below, and the assertions compare whitespace-collapsed text, which is why 'External ID:' appears
 * here without its leading space (Rule 1 clause 6).
 */
const ENGLISH_LABELS: readonly string[] = ['Client Number:', 'External ID:', 'Staff:'];

/**
 * The wording the in-memory English bundle below serves for the strip's three keys, keyed by the
 * legacy key itself: the bundle's values, not keys this spec invents, so an assertion can tell
 * which key produced which text and can never pass on a raw dotted key (Rule 1 clause 6).
 */
const ENGLISH_BUNDLE: Readonly<Record<string, string>> = {
  'label.heading.clientno': 'Client Number',
  'label.input.externalid': ' External ID',
  'label.input.staff': 'Staff',
};

/**
 * A second locale's wording for the same three keys, served to `TranslateService` in memory so the
 * language-switch case proves the strip reads whatever the active bundle says: a header that went
 * back to hardcoded English fails it. The wording is the shipped `locale-fr.json`'s own value for
 * each key, used as test input — no locale file is added, copied or edited (Rule 1 clause 6).
 */
const SWITCHED_LANGUAGE = 'fr';

/** The second locale's bundle, one distinct value per key, in the design's order. */
const SWITCHED_BUNDLE: Readonly<Record<string, string>> = {
  'label.heading.clientno': 'Numéro de client',
  'label.input.externalid': 'Identifiant externe',
  'label.input.staff': 'Équipe',
};

/** The three labels the strip must paint once {@link SWITCHED_LANGUAGE} is in force. */
const SWITCHED_LABELS: readonly string[] = [
  'Numéro de client:',
  'Identifiant externe:',
  'Équipe:',
];

/** The status object a client response sends, of which only `code` is ever read. */
function makeStatus(code: string, value: string = STATUS_VALUE_SENTINEL): ClientStatus {
  return { id: 300, code, value };
}

/**
 * A complete client record: the person the design's record shows, carrying every member `Client`
 * requires and the optional ones the header reads, so the file type-checks under `strict` and an
 * override below can drop a member without a cast (Rule 1 clause 4).
 */
function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 2,
    accountNo: ACCOUNT_NO,
    externalId: EXTERNAL_ID,
    displayName: 'Ada Okafor',
    firstname: 'Ada',
    lastname: 'Okafor',
    officeId: 1,
    officeName: 'Head Office',
    staffId: 7,
    staffName: STAFF_NAME,
    status: makeStatus('clientStatusType.active'),
    activationDate: [2026, 11, 21],
    timeline: { submittedOnDate: '2026-11-21', activatedOnDate: [2026, 11, 21] },
    ...overrides,
  };
}

/**
 * A freshly rendered header. `ComponentFixture.nativeElement` is typed `any` by Angular, so the host
 * is narrowed once here and every element the helpers below return is an `HTMLElement`: that single
 * narrowing keeps the whole spec type-checked (Rule 1 clause 4).
 */
function render(client: Client = makeClient()): ComponentFixture<RecordHeaderComponent> {
  const fixture = TestBed.createComponent(RecordHeaderComponent);

  fixture.componentRef.setInput('client', client);
  fixture.detectChanges();

  return fixture;
}

/** The fixture's host element, the root the assertions query. */
function hostOf(fixture: ComponentFixture<RecordHeaderComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * An element's text with runs of whitespace collapsed to one space and the ends trimmed, so an
 * assertion does not depend on the spacing between the template's own spans — or on the fact that
 * the compiler deletes a whitespace-only text node outright.
 */
function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The metadata strip's label and value spans in render order — label, value, label, value, … — which
 * is six elements for the design's three runs.
 *
 * The selector skips every `aria-hidden` span, so it reaches the runs without naming the strip's
 * own wrapper class: the indicator's span and the decorative pipe glyphs are both `aria-hidden` and
 * the header has no other span that is not.
 */
function runSpans(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('span:not([aria-hidden])'));
}

/** Every label of the metadata strip, in render order, each with the colon the header appends. */
function labelsOf(spans: readonly HTMLElement[]): string[] {
  return spans.filter((_span, index) => index % 2 === 0).map((span) => textOf(span));
}

/** Every value of the metadata strip, in render order, empty for a member the record omits. */
function valuesOf(spans: readonly HTMLElement[]): string[] {
  return spans.filter((_span, index) => index % 2 === 1).map((span) => textOf(span));
}

/** The status indicator's span, or a named failure when the header rendered no dot. */
function dotOf(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>('app-status-swatch .status-dot');

  if (element === null) {
    throw new Error('RecordHeaderComponent rendered no status dot');
  }

  return element;
}

/** The element holding the metadata strip: the parent of the first run's label. */
function stripOf(host: HTMLElement): HTMLElement {
  const strip = runSpans(host)[0]?.parentElement;

  if (!(strip instanceof HTMLElement)) {
    throw new Error('RecordHeaderComponent rendered no metadata runs');
  }

  return strip;
}

/** The header's title element, or a named failure when the header rendered none. */
function titleOf(host: HTMLElement): HTMLElement {
  const title = host.querySelector<HTMLElement>('h3');

  if (title === null) {
    throw new Error('RecordHeaderComponent rendered no record title');
  }

  return title;
}

describe('RecordHeaderComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordHeaderComponent],
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

    // Both bundles are loaded before the first render, so the first paint is English and the
    // switch case below needs no request: `setTranslation` is the in-memory store, the provider's
    // no-op loader is never reached (Rule 1 clause 8).
    const translate = TestBed.inject(TranslateService);

    translate.setTranslation('en', ENGLISH_BUNDLE, true);
    translate.setTranslation(SWITCHED_LANGUAGE, SWITCHED_BUNDLE, true);
    translate.use('en');
  });

  it.each(STATUS_CASES)(
    'renders one bare dot for the code %s, painted status-%s',
    (code: string, key: StatusKey) => {
      const host = hostOf(render(makeClient({ status: makeStatus(code) })));
      const dot = dotOf(host);

      // One indicator, on the title's line, with the base geometry and exactly one colour class.
      expect(host.querySelectorAll('app-status-swatch')).toHaveLength(1);
      expect(host.querySelector('h3 > app-status-swatch')).not.toBeNull();
      expect(dot.classList.contains('status-swatch')).toBe(true);
      expect(dot.classList.contains('status-dot')).toBe(true);
      expect(dot.classList.contains(`status-${key}`)).toBe(true);
      expect(dot.classList).toHaveLength(3);

      // Colour only: no word, no tooltip, no accessible label of its own.
      expect(dot.textContent).toBe('');
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.hasAttribute('title')).toBe(false);
      expect(dot.hasAttribute('aria-label')).toBe(false);
    },
  );

  it('prints the client name as the record’s single title line', () => {
    const host = hostOf(render());
    const title = titleOf(host);

    expect(host.querySelectorAll('h3')).toHaveLength(1);
    expect(textOf(title)).toBe('Ada Okafor');
    expect(textOf(title.querySelector('strong'))).toBe('Ada Okafor');
  });

  it('renders the three metadata runs in the design’s order, separated by exactly two pipes', () => {
    const host = hostOf(render());
    const spans = runSpans(host);

    expect(spans).toHaveLength(6);
    expect(labelsOf(spans)).toEqual(['Client Number:', 'External ID:', 'Staff:']);
    expect(valuesOf(spans)).toEqual([ACCOUNT_NO, EXTERNAL_ID, STAFF_NAME]);

    const glyphs = Array.from(
      host.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'),
    ).filter((span) => textOf(span) === '|');

    expect(glyphs).toHaveLength(2);
    expect(textOf(stripOf(host))).toBe(
      `Client Number: ${ACCOUNT_NO} | External ID: ${EXTERNAL_ID} | Staff: ${STAFF_NAME}`,
    );
  });

  it('rewrites the three labels when the language switches, instead of pinning English', () => {
    const fixture = render();
    const host = hostOf(fixture);

    expect(labelsOf(runSpans(host))).toEqual(ENGLISH_LABELS);

    // The switch either switcher makes: one active language on the one `TranslateService`, which
    // every translate pipe re-reads on the next check. The strip's values are the record's, so they
    // must not move with the language, and no English label may survive the switch — a header that
    // went back to hardcoded copy fails both assertions (Rule 1 clause 6, AAP 0.10.2).
    TestBed.inject(TranslateService).use(SWITCHED_LANGUAGE);
    fixture.detectChanges();

    const labels = labelsOf(runSpans(host));

    expect(labels).toEqual(SWITCHED_LABELS);
    for (const english of ENGLISH_LABELS) {
      expect(labels).not.toContain(english);
    }
    expect(valuesOf(runSpans(host))).toEqual([ACCOUNT_NO, EXTERNAL_ID, STAFF_NAME]);
  });

  it('paints an absent external id and staff as their label with an empty value', () => {
    const host = hostOf(
      render(makeClient({ externalId: undefined, staffId: undefined, staffName: undefined })),
    );
    const spans = runSpans(host);

    expect(labelsOf(spans)).toEqual(['Client Number:', 'External ID:', 'Staff:']);
    expect(valuesOf(spans)).toEqual([ACCOUNT_NO, '', '']);

    // The value cell holds neither text nor a placeholder: it is empty, not a dash and not a word.
    expect(spans[3]?.textContent).toBe('');
    expect(spans[5]?.textContent).toBe('');

    for (const standIn of STAND_IN_TEXT) {
      expect(textOf(host)).not.toContain(standIn);
    }
  });

  it('never renders the server’s status value, only the indicator', () => {
    const host = hostOf(
      render(makeClient({ status: makeStatus('clientStatusType.active', STATUS_VALUE_SENTINEL) })),
    );
    const text = textOf(host);

    expect(text).not.toContain(STATUS_VALUE_SENTINEL);
    expect(text).toContain('Ada Okafor');
    expect(text).toContain(ACCOUNT_NO);
    expect(dotOf(host).classList.contains('status-active')).toBe(true);
  });

  it.each(UNMAPPED_CODES)('falls back to the neutral colour for the code "%s"', (code: string) => {
    const host = hostOf(render(makeClient({ status: makeStatus(code) })));
    const dot = dotOf(host);

    // Neutral, never a claim: an unrecognised code must not paint a client as one of the named states.
    expect(dot.classList.contains('status-other')).toBe(true);
    expect(dot.classList.contains('status-active')).toBe(false);
    expect(dot.classList.contains('status-pending')).toBe(false);
    expect(dot.classList.contains('status-closed')).toBe(false);

    // The rest of the header is unaffected by the fallback.
    expect(dot.textContent).toBe('');
    expect(textOf(titleOf(host))).toBe('Ada Okafor');
    expect(runSpans(host)).toHaveLength(6);
  });

  it('renders nothing that could raise or display an error', () => {
    // The suite's TestBed registers the translate stack and nothing else, so the header rendering
    // at all is the statement that it needs no other service: it has no request to fail.
    const host = hostOf(render());

    expect(host.querySelector('app-notification')).toBeNull();
    expect(host.querySelector('.alert')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('form, input, button, select, textarea')).toBeNull();
  });

  it('closes the header with a single rule after the metadata strip', () => {
    const host = hostOf(render());
    const rules = Array.from(host.querySelectorAll<HTMLElement>('hr'));

    expect(rules).toHaveLength(1);

    // The rule is the header's own 1px #E5E5E5 section rule, not the global hairline: the class is
    // what makes web-ng/src/styles.scss paint color-section-rule, and the component carries no rule
    // of its own (AAP 0.2.3 row `RecordHeader`, Rule 1 clause 6).
    expect(rules[0]?.classList.contains('section-rule')).toBe(true);
    expect(rules[0]?.previousElementSibling).toBe(stripOf(host));
    expect(Array.from(host.children).map((child) => child.tagName)).toEqual(['H3', 'DIV', 'HR']);
  });
});
