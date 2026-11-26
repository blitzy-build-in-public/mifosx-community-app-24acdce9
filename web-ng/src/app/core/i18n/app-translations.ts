/** The application's own copy, carried here because no legacy bundle carries a key for the strings it holds. **Why the application has to own it.** Every other label in this migration resolves through the legacy `app/global-translations/locale-*.json` bundles `translate.config.ts` loads in place (Rule 1 clause 6; AAP 0.1.1, AAP 0.4.3), and a grep over all 32 of those files answers none of the nine keys below, while inventing them in a locale file would mean editing the read-only `app/` tree (Rule 1 clause 6). The screens that render them are still screens of this application, so their wording belongs to it. **English is the complete set and the fallback.** Every key below is carried in English, which is what `APP_OWNED_FALLBACK_LANG` names, so a language the application offers but does not translate one of these strings into still reads a sentence rather than a humanised key. **French is the one translation this run carries**, in {@link FRENCH_COPY}, for the keys the login screen and the clients list render. Any other offered language falls back to the English copy rather than to a humanised key, and deliberately so: a half-translated sentence assembled from `label.text.mifosx.community` would read worse than the English one. **A bundle still wins.** `FineractMissingTranslationHandler` is consulted only for a key the active and fallback bundles both lack, so the day a legacy or build-owned bundle carries any of these keys, that bundle's wording reaches the screen with no code change here (`web-ng/e2e/report/difference-register.ts` records the difference). */

/** The language {@link ENGLISH_COPY} is written in, and the one {@link appOwnedCopy} falls back to; fixed at `en` because that is the only set of these keys that is complete. */
export const APP_OWNED_FALLBACK_LANG = 'en';

/** The complete English copy, keyed exactly as the templates render it and in the order the screens read it: the clients list's card title, the shell's two idle-warning strings, and the login screen's closing paragraph. The wording is what the screens showed before this copy moved behind the translation layer — the card title is the design's own "List of Clients" (AAP 0.7.4) and the paragraph is legacy's own English sentence (`app/scripts/controllers/main/MainController.js:220-222`, Rule 1 clause 3) — so English renders byte for byte what it rendered before. */
const ENGLISH_COPY: ReadonlyMap<string, string> = new Map<string, string>([
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
]);

/** The French copy, carrying overrides only: every key here also sits in {@link ENGLISH_COPY}, and the two idle-warning strings are deliberately absent because the register records them as the application's English-only copy. Each French question and exclamation mark is preceded by U+202F, the narrow no-break space French typography uses before those marks, written as the escape `\u202f` so the character stays visible in this source. */
const FRENCH_COPY: ReadonlyMap<string, string> = new Map<string, string>([
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
]);

/** The translations the application carries beyond English, keyed by normalised language code, so {@link appOwnedCopy} answers one lookup rather than a branch per language. */
const OVERRIDES_BY_LANGUAGE: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map<
  string,
  ReadonlyMap<string, string>
>([['fr', FRENCH_COPY]]);

/** The copy to render for the active language: {@link ENGLISH_COPY} overlaid with that language's overrides, or the English map itself for a language the application carries no override for. A `Map` rather than a plain object on purpose, so a translation key such as `constructor` cannot resolve through `Object.prototype` and render a function body on screen. @param lang the active language code, as `TranslateService.getCurrentLang()` reports it; an unknown, blank or null code answers the English copy, which is the fallback every offered language resolves to. */
export function appOwnedCopy(lang: string | null | undefined): ReadonlyMap<string, string> {
  const code: string = (lang ?? '').trim().toLowerCase().replace(/-/g, '_');

  if (code.length === 0) {
    return ENGLISH_COPY;
  }

  const overrides: ReadonlyMap<string, string> | undefined =
    OVERRIDES_BY_LANGUAGE.get(code) ?? OVERRIDES_BY_LANGUAGE.get(code.split('_')[0]);

  if (overrides === undefined) {
    return ENGLISH_COPY;
  }

  const copy = new Map<string, string>(ENGLISH_COPY);

  for (const [key, text] of overrides) {
    copy.set(key, text);
  }

  return copy;
}
