import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import type { SearchScope } from '../api/search.service';

/**
 * What this control reports when the user submits a search: the text to search for, the scope they chose and whether that text arrived quoted (AAP 0.2.3's
 * `GlobalSearch` props `query`, `scope`, `(search)`; AAP 0.7.2's `GlobalSearchParams`). The query is already trimmed and stripped of the surrounding quotes legacy
 * removed, so the receiving screen can hand all three straight to `SearchService.search`: the flag is legacy's own reading of the typed text, taken here once.
 *
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
   * Legacy's `exactMatch` flag: `true` when the user quoted the text, which how a quoted search asks Fineract for the
   * literal string rather than a substring match, and `false` for unquoted input (AAP 0.3.4; AAP 0.7.2
   * `GlobalSearchParams`).
   */
  readonly exactMatch: boolean;
}

/**
 * The quotes legacy strips from a submitted search, and the reason `exactMatch` exists: `app/scripts/controllers/main/MainController.js:208-217` removes one leading and one trailing double quote before
 * searching, and searches exactly when that removal changed the text. The pattern is legacy's own, character for character, so the two implementations agree on inputs such as `"Ada`, `Ada"` and `""`.
 *
 */
const SURROUNDING_QUOTE = /(^"|"$)/g;

/**
 * Legacy translation key of each scope's label, keyed by the scope it labels. The keys are the ones the legacy navbar's scope list carried (`app/scripts/controllers/main/MainController.js`, `setSearchScopes`),
 * which is why the loans scope reads `label.input.adhoc.search.loans`: legacy reused that key for the value "Loans", and inventing a tidier key would put wording on screen the legacy bundle never held (Rule 1
 * clauses 3 and 6). Typed as `Record<SearchScope, string>` so the mapping is exhaustive.
 *
 */
const SCOPE_LABEL_KEYS: Record<SearchScope, string> = {
  all: 'label.search.scope.all',
  clients: 'label.search.scope.clients.and.clientIdentifiers',
  loans: 'label.input.adhoc.search.loans',
};

/**
 * The signed-in navbar's global search control — the `GlobalSearch` row of the component inventory (AAP 0.2.3) and part of the clients list screen in the "Sign in and open a client record" flow (Figma node
 * `1:3`, file `DKm5TBFbXypfqyx4xUdhBw`; AAP 0.7.1 `core/layout`, AAP 0.7.4). It emits and never searches: the control owns no request, endpoint or URL and injects no service at all, so it cannot reach
 * `SearchService` or `HttpClient` (Rule 1 clause 5), and the search belongs to the results screen that receives its `search` output. Nothing here is composed from the Fineract contract (Rule 1 clause 2, Rule
 * 2): the flag it reports is legacy's own reading of the typed text, and the wire's parameter names stay with `SearchService`. Its props are the inventory's: AAP 0.2.3's `GlobalSearch` row names `query:
 * string`, `scope` and `(search)`, so both values are inputs here and the state the user edits lives in the two internal controls behind them (there is no two-way binding, so typing never writes back to the
 * input that seeded the field). It reproduces the legacy control rather than improving it: legacy's navbar search (`app/views/_topnavbar.html:118-137`) is one text field with a scope selector that submits on
 * Enter, with no debounce, suggestion dropdown, recent searches or client-side filtering (Rule 1 clause 3), and the selector is a native `<select>`, the replacement for the jQuery `chosen` plugin the request
 * forbids (AAP 0.10.5 item 2). Its one keyboard affordance is legacy's own: `alt+x` focused the field (`app/scripts/controllers/main/MainController.js:330`), which is why the placeholder advertises it (AAP
 * 0.10.5 item 8; Rule 1 clauses 3 and 6). It carries no CSS: the design's 30px height, 1px `#E0E0E0` border, 2px radius and `#999999` placeholder come from the global `.navbar .form-control` and
 * `.form-control` rules in `web-ng/src/styles.scss` plus Bootstrap 3's own placeholder rule (Rule 1 clause 6, AAP 0.2.2). The state the design shows is idle — an empty field with its placeholder visible and
 * the default scope selected; the results and empty states belong to the search screen.
 *
 */
@Component({
  selector: 'app-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './global-search.component.html',
  host: {
    // The document-level binding exists only while this component does, so the chord is not a global handler the shell has to unbind. Legacy bound the same chord to the same field.
    '(document:keydown.alt.x)': 'focusField($event)',
  },
})
export class GlobalSearchComponent {
  /**
   * The text the control is seeded with — AAP 0.2.3's `GlobalSearch` prop `query: string`. It is the host's statement of
   * what the field starts on, not the text the user is editing: the field's own state is {@link queryControl}, and there
   * is no two-way binding, so a keystroke never writes back here.
   */
  readonly query = input<string>('');

  /**
   * The scope the control is seeded with — AAP 0.2.3's `GlobalSearch` prop `scope`, defaulting to `all`, both in-scope resource families at once, which is what legacy's scope list put first (AAP 0.10.5 item
   * 9). The value is the scope itself rather than the wire value of the `resource` parameter: that translation belongs to `SearchService.toResourceParam`, the one place it can drift from the request.
   *
   */
  readonly scope = input<SearchScope>('all');

  /**
   * The text being searched for, as the user edits it. Non-nullable, so an emptied field is the empty string rather than
   * `null` and `submit` has one shape to read. Internal: the host sees this state through {@link query} and the
   * component's own output, never as a control object.
   */
  readonly queryControl = new FormControl<string>('', { nonNullable: true });

  /**
   * The scope the selector shows, as the user set it — seeded from {@link scope} and reported
   * through `(search)`. Internal for the same reason as {@link queryControl}.
   */
  readonly scopeControl = new FormControl<SearchScope>('all', { nonNullable: true });

  /**
   * Writes a seeded input into the control it belongs to, so a host that sets `query` or `scope` is what the user meets. The effect reads the two inputs and nothing else, so it re-runs only when one of them
   * changes: typing moves the control, not the input, and therefore cannot clobber the text the user is still editing. The writes are `untracked` and emit no event, because seeding is not a search.
   *
   */
  constructor() {
    effect((): void => {
      const seededQuery: string = this.query();
      const seededScope: SearchScope = this.scope();

      untracked((): void => {
        this.queryControl.setValue(seededQuery, { emitEvent: false });
        this.scopeControl.setValue(seededScope, { emitEvent: false });
      });
    });
  }

  /**
   * Reports a submitted search to the navbar, which navigates to `/search/:query` and carries the scope and the exact-match flag as query parameters the results screen forwards. Never emitted for a query that
   * is empty, whitespace-only or nothing but its own surrounding quotes.
   *
   * The payload is AAP 0.2.3's `{query, scope}` pair plus legacy's `exactMatch` flag, which AAP 0.7.2's `GlobalSearchParams` and the results route require: it is the wire parameter legacy's `SearchController`
   * forwarded, and dropping it would change the request the results screen makes (Rule 1 clause 3).
   *
   * The name is fixed by the navbar's contract — `<app-global-search [scope]="searchScope()" (search)="onSearch($event)" />` (AAP 0.2.3's `(search)` prop) — and `search` is also the name of a native DOM event,
   * which is what `no-output-native` warns about. The warning does not apply: the binding lives on this component's own element, whose events are its own outputs, so no native event of that name can be
   * shadowed.
   *
   */
  readonly search = output<GlobalSearchSubmission>(); // eslint-disable-line @angular-eslint/no-output-native -- name fixed by the navbar contract

  /**
   * The text field itself, for the `alt+x` shortcut to focus. A signal query, so the shortcut needs no lifecycle hook to
   * hold a reference and cannot reach a destroyed element.
   */
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /**
   * The scopes on offer, in the order the selector renders them: "All" first, as legacy listed it. Exactly the three the plan keeps in scope; legacy's list also offered groups, savings and shares, and those
   * features belong to the legacy application during cutover, so a scope that could only return out-of-scope rows is absent from this type rather than rendered and refused (AAP 0.9.2, AAP 0.10.5 item 9).
   *
   */
  readonly scopes: readonly SearchScope[] = ['all', 'clients', 'loans'];

  /**
   * The translation key of a scope's label, for the template to resolve through `TranslatePipe`. A method rather than a
   * map folded into the template, so the key list stays a typed constant this file owns and an unlabelled scope cannot
   * reach the selector.
   *
   * @param scope One of {@link scopes}.
   * @returns the legacy translation key that labels it.
   */
  labelKey(scope: SearchScope): string {
    return SCOPE_LABEL_KEYS[scope];
  }

  /**
   * Puts the caret in the search field, which is what legacy's `alt+x` binding did (`app/scripts/controllers/main/MainController.js:330`) and what the field's
   * placeholder tells the user it will do. The key's own default is cancelled so the chord cannot also act on whatever else listens for it, and the user's partially
   * typed query survives the shortcut, as it did in legacy. @param event The key event Angular reports for `keydown.alt.x`.
   */
  focusField(event: Event): void {
    event.preventDefault();
    this.field()?.nativeElement.focus();
  }

  /**
   * Submits the search the way legacy's `ng-submit` handler did: read the field, strip the quotes legacy stripped, and do nothing at all when there is nothing left to search for.
   *
   * The query is trimmed and unquoted **before** it is emitted, because that text becomes a path segment of `/search/:query` and legacy derived both parameters from the same string:
   * `searchString.replace(/(^"|"$)/g, '')` gives what is searched for, and the flag is `true` when that removal changed the text (`app/scripts/controllers/main/MainController.js:208-217`, the contract
   * `SearchController.js:9` forwards as `exactMatch`). A query that is whitespace alone, or a pair of quotes alone, is therefore not sent at all rather than navigating to an empty search — a departure from
   * Rule 1 clause 3 only for that degenerate input. The field keeps exactly what the user typed, quotes included.
   *
   */
  submit(): void {
    const typed = this.queryControl.value.trim();
    const query = typed.replace(SURROUNDING_QUOTE, '');

    if (query.length === 0) {
      return;
    }

    this.search.emit({ query, scope: this.scopeControl.value, exactMatch: query !== typed });
  }
}
