import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  MissingTranslationHandler,
  TranslateService,
  provideTranslateService,
} from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FineractMissingTranslationHandler,
  humaniseKey,
} from '../../core/i18n/missing-translation.handler';
import { NotFoundComponent } from './not-found.component';

/**
 * Behaviour of the unknown-path screen: the component the router's `**` route selects, and the
 * message a 404 from a single record endpoint puts in place of the record (AAP 0.7.1, AAP 0.7.4,
 * AAP 0.9.1 item 1). It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1
 * ("each screen lands with at least one behavioural spec") and Rule 1 clause 8 (no spec without an
 * `expect`, nothing boilerplate).
 *
 * Providers, and why each one is there. `provideRouter([])` because the template reaches the client
 * list through `RouterLink`, which needs a router to resolve a destination; an empty route table is
 * enough, because these tests assert what the screen renders rather than where the router takes it.
 * The translate stack because every label resolves through `TranslatePipe`, and
 * `provideTranslateService()` is the library's own registration of `TranslateService` — declared
 * without `providedIn` in ngx-translate 18.1.0, so `TranslatePipe`'s non-optional
 * `inject(TranslateService)` would fail with NG0201 without it. Its omitted slots default to the
 * no-op loader, so no bundle is ever requested.
 *
 * Nothing else is provided, and that is the point: this folder owns no Fineract endpoint, so no HTTP
 * contract test belongs here and no HTTP backend is installed — `HttpClient`, the auth, permission
 * and session services are all absent. The screen meanwhile has to render for a signed-out user
 * before any guard has run, so rendering under an injector that holds no application service is
 * exactly the property the last test pins.
 *
 * The three keys below are the ones `not-found.component.html` resolves; a key changed there
 * changes here.
 */

/** Translation key of the card heading the template resolves. */
const HEADING_KEY = 'label.heading.notavailable';

/** Translation key of the body sentence the template resolves. */
const BODY_KEY = 'error.msg.resource.not.found';

/** Translation key of the label on the screen's single destination, the client list. */
const ACTION_KEY = 'label.button.clients';

/**
 * Stand-in for a shipped bundle, with one distinct value per key so an assertion can tell which key
 * produced which text. Test input only: it adds no locale file and reproduces no shipped
 * translation text (Rule 1 clause 6).
 */
const SPEC_BUNDLE: Record<string, string> = {
  [HEADING_KEY]: 'Heading from the spec bundle',
  [BODY_KEY]: 'Explanation from the spec bundle.',
  [ACTION_KEY]: 'Return to the client list',
};

/**
 * What the screen reads when no bundle carries any of its keys: the missing-translation handler's
 * humanised wording, in template order, and nothing besides it — the three labels concatenated,
 * which is how the assertion below compares them once whitespace is taken out of the picture.
 * Composing it from `humaniseKey` rather than writing the words out keeps this the handler's
 * guarantee rather than a second copy of its output.
 */
const FALLBACK_COPY: string = [HEADING_KEY, BODY_KEY, ACTION_KEY].map(humaniseKey).join('');

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps every
  // assertion below type-checked and confines the boundary cast to this line (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The card body, which holds the screen's whole message. */
  const panelBody = (): HTMLElement => {
    const body = host().querySelector<HTMLElement>('.panel .panel-body');
    if (body === null) {
      throw new Error('the screen must render its card body');
    }
    return body;
  };

  /**
   * The card body's text with every whitespace character removed, so the template's own indentation
   * and the renderer's whitespace collapsing cannot mislead a comparison. The screen's copy is three
   * labels in three elements, and the assertion that uses this compares the labels themselves.
   */
  const renderedCopy = (): string => (panelBody().textContent ?? '').replace(/\s+/g, '');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [
        provideRouter([]),
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

    fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
  });

  it('renders its message inside the legacy Bootstrap 3 card, with the primary-button destination', () => {
    const panel = host().querySelector<HTMLElement>('.panel');
    const body = panelBody();
    const button = body.querySelector<HTMLElement>('a.btn.btn-primary');

    expect(panel).not.toBeNull();
    expect((body.textContent ?? '').trim().length).toBeGreaterThan(0);
    expect(button?.tagName).toBe('A');
    expect(button?.classList.contains('btn')).toBe(true);
    expect(button?.classList.contains('btn-primary')).toBe(true);
  });

  it('resolves its copy through TranslatePipe', () => {
    TestBed.inject(TranslateService).setTranslation('en', SPEC_BUNDLE);
    fixture.detectChanges();

    const body = panelBody();
    const link = body.querySelector<HTMLElement>('a');

    expect(body.textContent).toContain(SPEC_BUNDLE[HEADING_KEY]);
    expect(body.textContent).toContain(SPEC_BUNDLE[BODY_KEY]);
    expect(link?.textContent?.trim()).toBe(SPEC_BUNDLE[ACTION_KEY]);
  });

  it('never shows a raw translation key: an absent key renders as humanised words', () => {
    const body = panelBody();
    const heading = body.querySelector<HTMLElement>('h1.panel-title');
    const paragraphs = Array.from(body.querySelectorAll<HTMLElement>('p'));
    const text = body.textContent ?? '';

    expect(heading?.textContent?.trim()).toBe(humaniseKey(HEADING_KEY));
    expect(paragraphs.map((paragraph) => paragraph.textContent?.trim())).toEqual([
      humaniseKey(BODY_KEY),
      humaniseKey(ACTION_KEY),
    ]);

    for (const key of [HEADING_KEY, BODY_KEY, ACTION_KEY]) {
      expect(text).not.toContain(key);
    }
  });

  it('offers the client list as its only way back', () => {
    const link = host().querySelector<HTMLAnchorElement>('a');

    expect(link).not.toBeNull();
    // The spec's router uses the default path location, so the destination renders as `/clients`;
    // the shipped application uses `withHashLocation()`, where the same destination is `#/clients`.
    expect(link?.getAttribute('href')).toBe('/clients');
  });

  it('renders exactly one link and no other control', () => {
    // One message and one way back is the whole surface this screen is allowed (Rule 1 clause 3):
    // a second destination would be an out-of-scope or a broken affordance.
    expect(host().querySelectorAll('a')).toHaveLength(1);
    expect(host().querySelectorAll('input, select, textarea, button, form')).toHaveLength(0);
  });

  it('renders for a signed-out user with no application service provided, and carries no signed-in chrome', () => {
    // The premise is the provider list above: a router and the library's translate stack, nothing
    // more — no HttpClient, no auth, permission or session service. Construction and rendering under
    // that injector is what shows the screen needs none of them, which is what lets an unmatched path
    // render before any guard has run. A dependency it gained on a service this injector does not
    // hold would fail at creation, an inlined English label would fail the copy assertion below, and
    // a second destination would fail the link test above.
    expect(fixture.componentInstance).toBeInstanceOf(NotFoundComponent);
    expect(renderedCopy()).toBe(FALLBACK_COPY);
    // The shell owns the navbar and the breadcrumb; an unknown path renders outside it.
    expect(host().querySelector('nav, .navbar, .breadcrumb')).toBeNull();
  });
});
