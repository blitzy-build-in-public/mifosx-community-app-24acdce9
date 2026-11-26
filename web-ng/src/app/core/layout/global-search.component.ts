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

/** What this control reports when the user submits a search: the trimmed, unquoted text, the scope chosen and whether it arrived quoted (AAP 0.2.3 `GlobalSearch` props; AAP 0.7.2 `GlobalSearchParams`). */
export interface GlobalSearchSubmission {
  /** The search text, trimmed and unquoted; never empty, because an empty search is not emitted at all. */
  readonly query: string;
  /** The scope the user selected, which `SearchService.toResourceParam` turns into `resource`. */
  readonly scope: SearchScope;
  /** Legacy's `exactMatch` flag: `true` when the user quoted the text, which is how a quoted search asks Fineract for the literal string rather than a substring match (AAP 0.3.4). */
  readonly exactMatch: boolean;
}

/** The quotes legacy strips from a submitted search — one leading and one trailing double quote, `app/scripts/controllers/main/MainController.js:208-217` — and the reason `exactMatch` is true when that removal changed the text. */
const SURROUNDING_QUOTE = /(^"|"$)/g;

/** Legacy translation key of each scope's label, keyed by scope and typed as a `Record` so the mapping is exhaustive; the loans scope reuses legacy's own `label.input.adhoc.search.loans`, because inventing a tidier key would put wording on screen the legacy bundle never held (Rule 1 clauses 3 and 6). */
const SCOPE_LABEL_KEYS: Record<SearchScope, string> = {
  all: 'label.search.scope.all',
  clients: 'label.search.scope.clients.and.clientIdentifiers',
  loans: 'label.input.adhoc.search.loans',
};

/** The signed-in navbar's global search control (AAP 0.2.3 `GlobalSearch`; Figma node `1:3`; AAP 0.7.1, AAP 0.7.4), which emits and never searches: it injects no service and composes no URL (Rule 1 clauses 2 and 5), reproduces legacy's control (`app/views/_topnavbar.html:118-137`) with a native `<select>` in place of the forbidden jQuery `chosen` (AAP 0.10.5 item 2), keeps its `alt+x` shortcut (AAP 0.10.5 item 8) and carries no CSS (Rule 1 clause 6). */
@Component({
  selector: 'app-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './global-search.component.html',
  host: {
    // The document-level binding exists only while this component does, so the chord is not a global handler the shell has to unbind.
    '(document:keydown.alt.x)': 'focusField($event)',
  },
})
export class GlobalSearchComponent {
  /** The text being searched for; non-nullable, so an emptied field is the empty string rather than `null` and `submit` has one shape to read. */
  readonly query = new FormControl<string>('', { nonNullable: true });

  /** The selected scope, defaulting to `all` — both in-scope resource families at once, which is what legacy's scope list put first (AAP 0.10.5 item 9); the wire value belongs to `SearchService.toResourceParam`. */
  readonly scope = new FormControl<SearchScope>('all', { nonNullable: true });

  /** Reports a submitted search to the navbar, which navigates to `/search/:query` carrying the scope and the exact-match flag; never emitted for a query that is empty, whitespace-only or nothing but its own surrounding quotes. The name is fixed by the navbar's contract (AAP 0.2.3's `(search)` prop). */
  readonly search = output<GlobalSearchSubmission>(); // eslint-disable-line @angular-eslint/no-output-native -- name fixed by the navbar contract

  /** The text field itself, for the `alt+x` shortcut to focus: a signal query, so the shortcut needs no lifecycle hook and cannot reach a destroyed element. */
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** The scopes on offer, in the order the selector renders them: "All" first, as legacy listed it, and only the three the plan keeps in scope (AAP 0.9.2, AAP 0.10.5 item 9). */
  readonly scopes: readonly SearchScope[] = ['all', 'clients', 'loans'];

  /** The translation key of a scope's label, for the template to resolve through `TranslatePipe`; a method, so the key list stays a typed constant this file owns and an unlabelled scope cannot reach the selector. */
  labelKey(scope: SearchScope): string {
    return SCOPE_LABEL_KEYS[scope];
  }

  /** Puts the caret in the search field, which is what legacy's `alt+x` binding did (`MainController.js:330`) and what the field's placeholder tells the user it will do; the key's own default is cancelled and the typed text is left alone. */
  focusField(event: Event): void {
    event.preventDefault();
    this.field()?.nativeElement.focus();
  }

  /** Submits the search as legacy's `ng-submit` handler did: the text is trimmed and unquoted before it is emitted, because that is the path segment of `/search/:query`, and the flag is true when the removal changed the text (`MainController.js:208-217`); nothing is emitted for a query with nothing left to search, and the field keeps exactly what the user typed. */
  submit(): void {
    const typed = this.query.value.trim();
    const query = typed.replace(SURROUNDING_QUOTE, '');

    if (query.length === 0) {
      return;
    }

    this.search.emit({ query, scope: this.scope.value, exactMatch: query !== typed });
  }
}
