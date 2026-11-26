import { TestBed, type ComponentFixture } from '@angular/core/testing';
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
import { RecordNotFoundComponent } from './record-not-found.component';

/** Behaviour of the one not-found presentation every record screen renders for a record it does not have (AAP 0.7.4 "States every list and record screen must implement"; Rule 1 clause 8): a single legacy `.alert.alert-danger` carrying the two shipped keys and nothing else. */

/** The heading key the template resolves, `label.heading.notavailable` in the shipped bundles. */
const HEADING_KEY = 'label.heading.notavailable';

/** The sentence key the template resolves, `error.msg.resource.not.found` in the shipped bundles. */
const BODY_KEY = 'error.msg.resource.not.found';

/** Stand-in for a shipped bundle, with one distinct value per key so an assertion can tell which key produced which text and in which order; test input only (Rule 1 clause 6). */
const SPEC_BUNDLE: Record<string, string> = {
  [HEADING_KEY]: 'Heading from the spec bundle',
  [BODY_KEY]: 'Explanation from the spec bundle.',
};

describe('RecordNotFoundComponent', () => {
  let fixture: ComponentFixture<RecordNotFoundComponent>;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps every assertion below type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The one element the component renders. */
  const alert = (): HTMLElement => {
    const element = host().querySelector<HTMLElement>('.alert.alert-danger');
    if (element === null) {
      throw new Error('the presentation must render its legacy danger alert');
    }
    return element;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordNotFoundComponent],
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

    TestBed.inject(TranslateService).setTranslation('en', SPEC_BUNDLE);
    fixture = TestBed.createComponent(RecordNotFoundComponent);
    fixture.detectChanges();
  });

  it('renders one legacy danger alert that announces itself and the whole of the message', () => {
    expect(host().childElementCount).toBe(1);
    expect(host().querySelectorAll('.alert')).toHaveLength(1);
    expect(alert().getAttribute('role')).toBe('alert');
    expect((alert().textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('resolves the heading and then the sentence from the two shipped keys, in that order', () => {
    expect((alert().textContent ?? '').trim()).toBe(
      `${SPEC_BUNDLE[HEADING_KEY]} ${SPEC_BUNDLE[BODY_KEY]}`,
    );
    expect(alert().querySelector('strong')?.textContent?.trim()).toBe(SPEC_BUNDLE[HEADING_KEY]);
    expect(alert().querySelector('span')?.textContent?.trim()).toBe(SPEC_BUNDLE[BODY_KEY]);
    // Neither key reaches the screen raw (AAP 0.3.1's missing-translation guarantee, resolved rather than echoed).
    const text = alert().textContent ?? '';
    expect(text).not.toContain(HEADING_KEY);
    expect(text).not.toContain(BODY_KEY);
  });

  it('offers no control, icon, status word or second region of its own', () => {
    expect(alert().childElementCount).toBe(2);
    expect(
      alert().querySelectorAll(
        'button, a, input, select, textarea, form, img, svg, i, .text-center, .text-muted',
      ),
    ).toHaveLength(0);
    expect(host().querySelectorAll('button, a, input, select, textarea, form')).toHaveLength(0);
    expect(alert().getAttribute('title')).toBeNull();
    expect(alert().hasAttribute('style')).toBe(false);
  });

  it('renders humanised words rather than a raw key when no bundle carries the two keys', () => {
    TestBed.inject(TranslateService).setTranslation('en', {}, false);
    fixture.detectChanges();

    const text = alert().textContent ?? '';

    expect(text).toContain(humaniseKey(HEADING_KEY));
    expect(text).toContain(humaniseKey(BODY_KEY));
    expect(text).not.toContain(HEADING_KEY);
    expect(text).not.toContain(BODY_KEY);
  });
});
