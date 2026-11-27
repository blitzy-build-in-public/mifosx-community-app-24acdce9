import { describe, expect, it } from 'vitest';

import { APP_OWNED_FALLBACK_LANG, appOwnedCopy } from './app-translations';

/** Behaviour of the application's own copy — the strings no legacy bundle under the read-only `app/global-translations/` tree carries a key for (Rule 1 clause 6; AAP 0.1.1, AAP 0.7.4), and the one place their French wording lives. It discharges Rule 1 clause 8 (no spec without an `expect`) and pins the three things the screens rely on: every key answers the wording it answered before the copy moved behind the translation layer, every language the application carries overrides for answers French there and English everywhere else, and a key that names an `Object.prototype` member resolves to nothing rather than to a function body — which is why the copy is a `Map`. */

/** The complete English copy, written out here rather than read back from the module, so a wrong or missing entry fails against the wording the screens render instead of against itself. The card title is the design's own "List of Clients" (AAP 0.7.4) and the paragraph is legacy's own English sentence (`app/scripts/controllers/main/MainController.js:220-222`, Rule 1 clause 3). */
const ENGLISH_COPY: readonly (readonly [key: string, text: string])[] = [
  ['label.heading.listofclients', 'List of Clients'],
  ['label.message.session.expiring', 'You have been inactive and will be signed out shortly.'],
  ['label.button.stay.signed.in', 'Stay signed in'],
  ['label.text.mifosx.designedby', 'Mifos X is designed by the'],
  ['label.anchor.mifosinitiative', 'Mifos Initiative'],
  ['label.anchor.globalcommunity', 'A global community'],
  [
    'label.text.mifosx.community',
    'that aims to speed the elimination of poverty by enabling Organizations to more effectively and efficiently deliver responsible financial services to the world’s poor and unbanked.',
  ],
  ['label.text.mifosx.interesting', 'Sounds interesting?'],
  ['label.anchor.getinvolved', 'Get involved!'],
];

/** The French overrides, written out for the same reason: the seven keys the clients list and the login screen render. The two idle-warning keys are deliberately absent — the deliberate-difference register records them as the application's English-only copy. */
const FRENCH_COPY: readonly (readonly [key: string, text: string])[] = [
  ['label.heading.listofclients', 'Liste des clients'],
  ['label.text.mifosx.designedby', 'Mifos X est conçu par la'],
  ['label.anchor.mifosinitiative', 'Mifos Initiative'],
  ['label.anchor.globalcommunity', 'Une communauté mondiale'],
  [
    'label.text.mifosx.community',
    'qui vise à accélérer l’élimination de la pauvreté en permettant aux organisations de fournir plus efficacement des services financiers responsables aux populations pauvres et non bancarisées du monde.',
  ],
  ['label.text.mifosx.interesting', 'Cela vous intéresse\u202f?'],
  ['label.anchor.getinvolved', 'Participez\u202f!'],
];

const ENGLISH_ONLY_KEYS: readonly string[] = [
  'label.message.session.expiring',
  'label.button.stay.signed.in',
];

const FALLBACK_CODES: readonly (string | null | undefined)[] = [
  APP_OWNED_FALLBACK_LANG,
  null,
  undefined,
  '',
  '   ',
  'de',
  'constructor',
];

describe('appOwnedCopy', () => {
  it.each(ENGLISH_COPY)('answers %s in English with the wording the screens have always rendered', (key: string, text: string) => {
    const copy = appOwnedCopy(APP_OWNED_FALLBACK_LANG);

    expect(copy.get(key)).toBe(text);
    // Never the key itself: the whole point of carrying the copy here is that no raw key or humanised fragment reaches the screen (AAP 0.1.1, AAP 0.3.1).
    expect(copy.get(key)).not.toBe(key);
  });

  it('holds exactly the nine English keys, in the order the screens read them', () => {
    expect([...appOwnedCopy(APP_OWNED_FALLBACK_LANG).keys()]).toEqual(ENGLISH_COPY.map(([key]) => key));
    expect(appOwnedCopy(APP_OWNED_FALLBACK_LANG).get('label.heading.listofclients')).toBe('List of Clients');
  });

  it.each(FRENCH_COPY)('translates %s into French, with a value of its own', (key: string, text: string) => {
    const french = appOwnedCopy('fr').get(key);

    expect(french).toBe(text);
    expect((french ?? '').trim().length).toBeGreaterThan(0);
  });

  it('rewords every French override except the one proper name both languages spell the same', () => {
    const english = appOwnedCopy(APP_OWNED_FALLBACK_LANG);
    const french = appOwnedCopy('fr');
    const unchanged: string[] = FRENCH_COPY.map(([key]) => key)
      .filter((key: string) => french.get(key) === english.get(key));

    // An organisation's name reads the same in both languages, and every other override is a French sentence a reader would notice missing.
    expect(unchanged).toEqual(['label.anchor.mifosinitiative']);
  });

  it.each(FALLBACK_CODES)('falls back to the English copy for the code %j', (code: string | null | undefined) => {
    // The very same map, not a copy of it: an unknown language answers the English set rather than a half-translated one.
    expect(appOwnedCopy(code)).toBe(appOwnedCopy(APP_OWNED_FALLBACK_LANG));
  });

  it.each(['fr', 'FR', 'fr-FR', 'fr_FR', ' Fr '])('resolves the French copy for the code %j', (code: string) => {
    expect(appOwnedCopy(code).get('label.heading.listofclients')).toBe('Liste des clients');
    expect(appOwnedCopy(code).get('label.anchor.getinvolved')).toBe('Participez\u202f!');
  });

  it('carries every English key in the French result, so no French render falls back mid-sentence', () => {
    const french = appOwnedCopy('fr');

    expect(french.size).toBe(ENGLISH_COPY.length);
    for (const [key] of ENGLISH_COPY) {
      expect(french.has(key)).toBe(true);
      expect((french.get(key) ?? '').length).toBeGreaterThan(0);
    }
  });

  it('leaves the two idle-warning strings in English under French, which the register records', () => {
    const french = appOwnedCopy('fr');

    for (const key of ENGLISH_ONLY_KEYS) {
      expect(french.get(key)).toBe(appOwnedCopy(APP_OWNED_FALLBACK_LANG).get(key));
    }
  });

  it('answers nothing for a key that names an Object.prototype member', () => {
    // A plain object would hand `constructor` the `Object` function and print a function body on screen; a `Map` has no prototype chain to walk.
    expect(appOwnedCopy(APP_OWNED_FALLBACK_LANG)).toBeInstanceOf(Map);
    expect(appOwnedCopy(APP_OWNED_FALLBACK_LANG).get('constructor')).toBeUndefined();
    expect(appOwnedCopy('fr').get('constructor')).toBeUndefined();
    expect(appOwnedCopy('fr').get('toString')).toBeUndefined();
  });
});
