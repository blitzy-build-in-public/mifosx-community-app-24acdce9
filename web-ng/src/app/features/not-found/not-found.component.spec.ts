import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { provideTranslate } from '../../core/i18n/translate.config';
import { NotFoundComponent } from './not-found.component';

/**
 * Behavioural spec for the unknown-path screen — the `**` route's component, and the counterpart of
 * the legacy application's `.otherwise` fallback, which renders `views/errors/404.html` (AAP 0.9.1
 * item 1, AAP 0.7.1, AAP 0.7.4).
 *
 * It serves three AAP rows: 0.11.1 (unit spec beside every component and service), 0.14.1 ("each
 * screen lands with at least one behavioural spec") and 0.14.2 ("no spec without an `expect`").
 *
 * The screen is exercised through the production i18n stack rather than a stubbed pipe, exactly as
 * `core/i18n/missing-translation.handler.spec.ts` does: `provideTranslate()` wires the loader to the
 * legacy asset path, the bundle arrives over `HttpTestingController`, and the spec fails if the
 * screen issues any other request.
 */

/** Key of the card heading the template resolves (AAP 0.7.4 "the not-found message"). */
const HEADING_KEY = 'label.heading.notavailable';

/** Key of the body sentence the template resolves. */
const BODY_KEY = 'error.msg.resource.not.found';

/** Key of the label of the screen's single destination, the client list. */
const ACTION_KEY = 'label.button.clients';

/**
 * Stand-in for the English bundle `app/global-translations/locale-en.json`, with one distinct value
 * per key so the spec can tell which key produced which text.
 *
 * Test input only: this is not an application translation source, it adds no locale file and it is
 * not derived from any translation text the build ships (Rule 1 clause 6).
 */
const EN_BUNDLE: Record<string, string> = {
  [HEADING_KEY]: 'Heading from the spec bundle',
  [BODY_KEY]: 'Explanation from the spec bundle.',
  [ACTION_KEY]: 'Return to the client list',
};

/**
 * Served path of the English bundle, written as a literal rather than composed from the loader
 * constants: a bundle that 404s at a different URL must fail this spec.
 */
const EN_BUNDLE_URL = 'global-translations/locale-en.json';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
  // assertions below type-checked and confines the cast to this single boundary (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [
        // The template reaches the client list through `RouterLink`, which needs a router to
        // resolve a destination. An empty route table is enough: this spec asserts what the screen
        // renders, not where the router takes it.
        provideRouter([]),
        provideTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    const httpMock = TestBed.inject(HttpTestingController);
    const loaded = firstValueFrom(translate.use('en'));

    httpMock.expectOne(EN_BUNDLE_URL).flush(EN_BUNDLE);
    await loaded;
    httpMock.verify();

    fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
  });

  it('resolves its heading, body and action label through TranslatePipe', () => {
    const heading = host().querySelector('h4.panel-title');
    const paragraphs = Array.from(host().querySelectorAll('.panel-body p'));

    expect(heading?.textContent?.trim()).toBe(EN_BUNDLE[HEADING_KEY]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent?.trim()).toBe(EN_BUNDLE[BODY_KEY]);
    expect(paragraphs[1].querySelector('a')?.textContent?.trim()).toBe(EN_BUNDLE[ACTION_KEY]);
  });

  it('never shows a raw translation key to the user', () => {
    const text = host().textContent ?? '';

    expect(text).toContain(EN_BUNDLE[HEADING_KEY]);
    expect(text).toContain(EN_BUNDLE[BODY_KEY]);
    expect(text).toContain(EN_BUNDLE[ACTION_KEY]);

    for (const key of [HEADING_KEY, BODY_KEY, ACTION_KEY]) {
      expect(text).not.toContain(key);
    }
  });

  it('offers exactly one destination, and it is the client list', () => {
    const anchors = Array.from(host().querySelectorAll('a'));

    expect(anchors).toHaveLength(1);
    // The template carries no `href` of its own, so a resolved attribute can only come from
    // `RouterLink` turning `/clients` into a destination.
    expect(anchors[0].getAttribute('href') ?? '').toMatch(/\/clients$/);
    expect(anchors[0].getAttribute('href')).not.toBe('#');
  });

  it('keeps the legacy Bootstrap 3 panel composition', () => {
    const panel = host().querySelector('.panel');
    const panelBody = panel?.querySelector('.panel-body');
    const heading = panelBody?.querySelector('h4.panel-title');

    expect(panel).not.toBeNull();
    expect(panelBody).not.toBeNull();
    expect(heading?.textContent?.trim()).toBe(EN_BUNDLE[HEADING_KEY]);
    expect(host().querySelector('a')?.classList.contains('btn')).toBe(true);
    expect(host().querySelector('a')?.classList.contains('btn-primary')).toBe(true);
    expect(host().querySelector('a.btn.btn-primary')).not.toBeNull();
  });

  it('renders no control beyond that single routed destination', () => {
    expect(host().querySelectorAll('input, select, textarea, button, form')).toHaveLength(0);
    expect(host().querySelectorAll('a')).toHaveLength(1);
  });
});
