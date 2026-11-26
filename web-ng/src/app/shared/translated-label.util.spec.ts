import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTranslatedLabels, type TranslatedLabel } from './translated-label.util';


type Bundle = Readonly<Record<string, string>>;

const ENGLISH: Bundle = { 'label.input.product': 'Product', 'label.input.submittedon': 'Submitted on', };

const FRENCH: Bundle = { 'label.input.product': 'Produit', 'label.input.submittedon': 'Soumis le', };

interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  readonly onLangChange: Subject<unknown>;
  readonly onTranslationChange: Subject<unknown>;
}

describe('createTranslatedLabels', () => {
  let bundle: Bundle;
  let language: WritableSignal<string>;
  let onLangChange: Subject<unknown>;
  let onTranslationChange: Subject<unknown>;

  /** Creates one resolver in the TestBed's injection context, as a component field initializer does. */
  function resolver(): TranslatedLabel {
    return TestBed.runInInjectionContext(() => createTranslatedLabels());
  }

  beforeEach(() => {
    bundle = ENGLISH;
    language = signal('en');
    onLangChange = new Subject<unknown>();
    onTranslationChange = new Subject<unknown>();

    const stub: TranslateStub = {
      currentLang: language.asReadonly(), instant: (key: string): string => bundle[key] ?? key, onLangChange, onTranslationChange, };

    TestBed.configureTestingModule({ providers: [{ provide: TranslateService, useValue: stub }] });
  });

  it("answers the loaded bundle's text for a key", () => {
    const translated = resolver();

    const label = translated('label.input.product');

    expect(label()).toBe('Product');
  });

  it('resolves each key to its own text', () => {
    const translated = resolver();

    const product = translated('label.input.product');
    const submittedOn = translated('label.input.submittedon');

    expect(product()).toBe('Product');
    expect(submittedOn()).toBe('Submitted on');
  });

  it('re-resolves every label when onLangChange lands a different bundle', () => {
    const translated = resolver();
    const product = translated('label.input.product');
    const submittedOn = translated('label.input.submittedon');
    expect(product()).toBe('Product');

    bundle = FRENCH;
    language.set('fr');
    onLangChange.next({ lang: 'fr' });

    expect(product()).toBe('Produit');
    expect(submittedOn()).toBe('Soumis le');
  });

  it('re-resolves when onTranslationChange lands a bundle for the active language', () => {
    const translated = resolver();
    const submittedOn = translated('label.input.submittedon');
    expect(submittedOn()).toBe('Submitted on');

    bundle = { 'label.input.submittedon': 'Date de soumission' };
    onTranslationChange.next({ translations: bundle, lang: 'en' });

    expect(submittedOn()).toBe('Date de soumission');
  });

  it('replaces the fallback a key resolved to before its bundle arrived', () => {
    // The first paint of this screen happens before the bundle lands, so `instant` can only answer with the key itself; the label must not stay at that fallback for the life of the screen.
    bundle = {};
    const translated = resolver();
    const product = translated('label.input.product');
    expect(product()).toBe('label.input.product');

    bundle = ENGLISH;
    onTranslationChange.next({ translations: bundle, lang: 'en' });

    expect(product()).toBe('Product');
  });
});
