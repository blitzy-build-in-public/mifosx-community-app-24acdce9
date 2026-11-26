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

/** Behaviour of the unknown-path screen, which renders for an unmatched URL and for a 404 of a single record (AAP 0.7.1, AAP 0.7.4, AAP 0.9.1 item 1; AAP 0.11.1; Rule 1 clause 8): the injector holds a router and the translate stack and nothing else, so rendering under it is the statement that the screen needs no application service before any guard has run. */

const HEADING_KEY = 'label.heading.notavailable';

const BODY_KEY = 'error.msg.resource.not.found';

const ACTION_KEY = 'label.button.clients';

/** Stand-in for a shipped bundle, with one distinct value per key so an assertion can tell which key produced which text; test input only (Rule 1 clause 6). */
const SPEC_BUNDLE: Record<string, string> = {
  [HEADING_KEY]: 'Heading from the spec bundle',
  [BODY_KEY]: 'Explanation from the spec bundle.',
  [ACTION_KEY]: 'Return to the client list',
};

const FALLBACK_COPY: string = [HEADING_KEY, BODY_KEY, ACTION_KEY].map(humaniseKey).join('');

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps every assertion below type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const panelBody = (): HTMLElement => {
    const body = host().querySelector<HTMLElement>('.panel .panel-body');
    if (body === null) {
      throw new Error('the screen must render its card body');
    }
    return body;
  };

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
    // The spec's router uses the default path location, so the destination renders as `/clients`; the application uses `withHashLocation()`.
    expect(link?.getAttribute('href')).toBe('/clients');
  });

  it('renders exactly one link and no other control', () => {
    // One message and one way back is the whole surface this screen is allowed (Rule 1 clause 3).
    expect(host().querySelectorAll('a')).toHaveLength(1);
    expect(host().querySelectorAll('input, select, textarea, button, form')).toHaveLength(0);
  });

  it('renders for a signed-out user with no application service provided, and carries no signed-in chrome', () => {
    expect(fixture.componentInstance).toBeInstanceOf(NotFoundComponent);
    expect(renderedCopy()).toBe(FALLBACK_COPY);
    expect(host().querySelector('nav, .navbar, .breadcrumb')).toBeNull();
  });
});
