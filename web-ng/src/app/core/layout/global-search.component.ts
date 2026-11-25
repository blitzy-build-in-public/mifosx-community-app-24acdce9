import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  output,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import type { SearchScope } from '../api/search.service';

/**
 * What this control reports when the user submits a search: the text to search for, the scope they
 * chose and whether that text arrived quoted (AAP 0.2.3's `GlobalSearch` props `query`, `scope`,
 * `(search)`; AAP 0.7.2's `GlobalSearchParams`).
 *
 * The query is already trimmed and stripped of the surrounding quotes legacy removed, and the scope
 * is one of the three {@link SearchScope} values, so the receiving screen can hand all three
 * straight to `SearchService.search` without re-checking or re-deriving any of them: the flag is
 * legacy's own reading of the text the user typed, and it is taken here once.
 */
export interface GlobalSearchSubmission {
  /**
   * The search text, trimmed and unquoted; never empty, because an empty search is not emitted at
   * all.
   */
  readonly query: string;

  /** The scope the user selected, which `SearchService.toResourceParam` turns into `resource`. */
  readonly scope: SearchScope;

  /**
   * Legacy's `exactMatch` flag: `true` when the user quoted the text, which is how a quoted search
   * asks Fineract for the literal string rather than a substring match, and `false` for unquoted
   * input (AAP 0.3.4; AAP 0.7.2's `GlobalSearchParams`).
   */
  readonly exactMatch: boolean;
}

/**
 * The quotes legacy strips from a submitted search, and the reason `exactMatch` exists:
 * `app/scripts/controllers/main/MainController.js:208-217` removes one leading and one trailing
 * double quote from the text before searching, and searches exactly when that removal changed it.
 *
 * The pattern is legacy's own, character for character, so the two implementations agree on inputs
 * such as `"Ada`, `Ada"` and `""`. `String.prototype.replace` starts a global search at the
 * beginning of the string on every call, so one instance carries no state between submissions.
 */
const SURROUNDING_QUOTE = /(^"|"$)/g;

/**
 * Legacy translation key of each scope's label, keyed by the scope it labels.
 *
 * The keys are the ones the legacy navbar's scope list carried
 * (`app/scripts/controllers/main/MainController.js`, `setSearchScopes`), which is why the loans
 * scope reads `label.input.adhoc.search.loans`: legacy reused that key for the value "Loans", and
 * inventing a tidier key here would put wording on screen that the legacy bundle never held
 * (Rule 1 clause 3, Rule 1 clause 6).
 *
 * Typed as `Record<SearchScope, string>` so the mapping is exhaustive: adding a scope to the union
 * without deciding what it reads is a compile error rather than a blank option in the menu.
 */
const SCOPE_LABEL_KEYS: Record<SearchScope, string> = {
  all: 'label.search.scope.all',
  clients: 'label.search.scope.clients.and.clientIdentifiers',
  loans: 'label.input.adhoc.search.loans',
};

/**
 * The signed-in navbar's global search control — the `GlobalSearch` row of the component inventory
 * (AAP 0.2.3) and part of the clients list screen in the "Sign in and open a client record" flow
 * (Figma node `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.1 `core/layout`, AAP 0.7.4).
 *
 * **It emits and never searches.** The control owns no request, no endpoint and no URL: it injects
 * no service at all — the only query it holds is a view reference to its own field — so it cannot
 * reach `SearchService` or `HttpClient` (Rule 1 clause 5), and the search itself belongs to the
 * results screen that receives this component's `search` output. Nothing here is composed from the
 * Fineract contract — no URL, no parameter spelling, no header (Rule 1 clause 2, Rule 2): the flag
 * it reports is legacy's own reading of the typed text, and the wire's parameter names stay with
 * `SearchService`.
 *
 * **It reproduces the legacy control rather than improving it.** Legacy's navbar search
 * (`app/views/_topnavbar.html:118-137`) is one text field with a scope selector beside it that
 * submits on Enter through the form's own submit handler; there is no debounce, no suggestion
 * dropdown, no recent searches and no client-side filtering, so this component has none of those
 * either (Rule 1 clause 3). The scope selector is a native `<select>`, the Angular-native
 * replacement for the jQuery `chosen` plugin the request forbids (AAP 0.10.5 item 2).
 *
 * **It carries no CSS.** The design's 30px height (`space-nav-control`), 1px `#E0E0E0` border,
 * 2px radius and `#999999` placeholder are produced by the global `.navbar .form-control` and
 * `.form-control` rules in `web-ng/src/styles.scss` plus Bootstrap 3's own placeholder rule, so the
 * template names Bootstrap classes and this file defines no style, no hex value and no dimension
 * (Rule 1 clause 6, AAP 0.2.2's token manifest).
 *
 * The state the design shows is idle: an empty field with its placeholder visible and the default
 * scope selected. Typing, clearing and re-submitting are the same control's ordinary states; the
 * results and empty states belong to the search screen.
 *
 * **Its one keyboard affordance is legacy's own.** Legacy bound `alt+x` to
 * `document.getElementById('search').focus()` (`app/scripts/controllers/main/MainController.js:330`),
 * which is why its field carries the placeholder "Click or press alt+x to Search". The shortcut is
 * reproduced on the element's host so the promise the placeholder makes is kept: a placeholder that
 * advertises a shortcut nothing implements would be the broken affordance this migration avoids
 * (AAP 0.10.5 item 8), and it changes nothing visually (Rule 1 clause 3, Rule 1 clause 6).
 */
@Component({
  selector: 'app-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './global-search.component.html',
  host: {
    // The document-level binding exists only while this component does, so the chord is not a
    // global handler the shell has to unbind. Legacy bound the same chord to the same field.
    '(document:keydown.alt.x)': 'focusField($event)',
  },
})
export class GlobalSearchComponent {
  /**
   * The text being searched for. Non-nullable, so an emptied field is the empty string rather than
   * `null` and `submit` has one shape to read.
   */
  readonly query = new FormControl<string>('', { nonNullable: true });

  /**
   * The selected scope, defaulting to `all` — both in-scope resource families at once, which is
   * what legacy's scope list put first (AAP 0.10.5 item 9). The value is the scope itself rather
   * than the wire value of the `resource` parameter: that translation belongs to
   * `SearchService.toResourceParam`, which is the one place it can drift from the request.
   */
  readonly scope = new FormControl<SearchScope>('all', { nonNullable: true });

  /**
   * Reports a submitted search to the navbar, which navigates to `/search/:query` and carries the
   * scope and the exact-match flag as query parameters the results screen forwards. Never emitted
   * for a query that is empty, whitespace-only or nothing but its own surrounding quotes.
   *
   * The name is fixed by the navbar's contract — `<app-global-search (search)="onSearch($event)" />`
   * (AAP 0.2.3's `(search)` prop) — and `search` is also the name of a native DOM event, which is
   * what `no-output-native` warns about. The warning does not apply to this control: the binding
   * lives on this component's own element, whose events are its own outputs, so no native event of
   * that name can be shadowed by it.
   */
  readonly search = output<GlobalSearchSubmission>(); // eslint-disable-line @angular-eslint/no-output-native -- name fixed by the navbar contract

  /**
   * The text field itself, for the `alt+x` shortcut to focus. A signal query, so the shortcut needs
   * no lifecycle hook to hold a reference and cannot reach a destroyed element (Angular 22 reads a
   * view query lazily and returns `undefined` once the view is gone).
   */
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /**
   * The scopes on offer, in the order the selector renders them: "All" first, as legacy listed it.
   *
   * Exactly the three the plan keeps in scope. Legacy's list also offered groups, savings and
   * shares; those features belong to the legacy application during cutover, so a scope that could
   * only return out-of-scope rows is absent from this type rather than rendered and refused
   * (AAP 0.9.2, AAP 0.10.5 item 9).
   */
  readonly scopes: readonly SearchScope[] = ['all', 'clients', 'loans'];

  /**
   * The translation key of a scope's label, for the template to resolve through `TranslatePipe`.
   *
   * A method rather than a map folded into the template so the key list stays a typed constant this
   * file owns, and so an unlabelled scope cannot reach the selector.
   *
   * @param scope One of {@link scopes}.
   * @returns the legacy translation key that labels it.
   */
  labelKey(scope: SearchScope): string {
    return SCOPE_LABEL_KEYS[scope];
  }

  /**
   * Puts the caret in the search field, which is what legacy's `alt+x` binding did
   * (`app/scripts/controllers/main/MainController.js:330`) and what the field's placeholder tells
   * the user it will do.
   *
   * The key's own default is cancelled so the chord cannot also act on whatever else listens for it,
   * and nothing else happens: legacy focused the field and left its text alone, so the user's
   * partially typed query survives the shortcut.
   *
   * @param event The key event Angular reports for `keydown.alt.x`.
   */
  focusField(event: Event): void {
    event.preventDefault();
    this.field()?.nativeElement.focus();
  }

  /**
   * Submits the search the way legacy's `ng-submit` handler did: read the field, strip the quotes
   * legacy stripped, and do nothing at all when there is nothing left to search for.
   *
   * The query is trimmed and unquoted **before** it is emitted, because that is the text that
   * becomes a path segment of `/search/:query`, and legacy derived both of its parameters from the
   * very same string: `searchString.replace(/(^"|"$)/g, '')` gives what is searched for, and the
   * flag is `true` when that removal changed the text
   * (`app/scripts/controllers/main/MainController.js:208-217`, the contract
   * `SearchController.js:9` forwards as `exactMatch`). A query that is whitespace alone, or a pair
   * of quotes alone, is therefore not sent at all rather than navigating to an empty search — the
   * blank-search rule this control already applied to whitespace, and a departure from Rule 1
   * clause 3 only for that degenerate input, where legacy would have navigated to an empty
   * `/search/`.
   *
   * The field itself keeps exactly what the user typed, quotes included, so the text on screen never
   * changes under them while they are still editing it.
   *
   * Nothing is sent while the user is still typing — this runs only on submit — and a second
   * submission is a second search, as it is in legacy: there is no de-duplication to add here
   * (Rule 1 clause 3).
   */
  submit(): void {
    const typed = this.query.value.trim();
    const query = typed.replace(SURROUNDING_QUOTE, '');

    if (query.length === 0) {
      return;
    }

    this.search.emit({ query, scope: this.scope.value, exactMatch: query !== typed });
  }
}
