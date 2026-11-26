import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** One entry of a record's tab strip; the parent supplies both the id and the display label. */
export interface TabDescriptor {
  /** Stable identifier of the tab; opaque to this component, which only compares it for equality. */
  readonly id: string;
  /** Display text, shown verbatim: the parent owns the wording, so translation happens there. */
  readonly label: string;
}

/** The prefix of every DOM id this component mints for a tab, so a tab element's id cannot collide with an id a record template declares for its own hooks. */
const TAB_DOM_ID_PREFIX = 'record-tab';

/** The DOM id this component gives the tab whose own id is `id`. The strip owns the id rather than the parent, because a tab element and the panel that is labelled by it have to agree: a record template binds its active section's `aria-labelledby`
 * to `tabDomId(<the id of its active tab>)` and gets back exactly the id the strip put on that tab's element, so the panel is announced as that tab's panel (AAP 0.2.3 row `TabStrip`). @param id the tab's own id, as the parent supplied it in its
 * {@link TabDescriptor}. @returns the tab element's DOM id, a stable function of `id`. */
export function tabDomId(id: string): string {
  return `${TAB_DOM_ID_PREFIX}-${id}`;
}

/** The record tab strip both record screens share — the `TabStrip` row of the component inventory, one active tab of N (AAP 0.2.3). Its first consumer is the individual client record, whose two in-scope tabs it renders on the client view screen of
 * the "Sign in and open a client record" flow (Figma node `1:4`); its second is the individual loan record, whose repayment schedule, transactions and charges sections it switches between. It lives in `shared/` because it is a presentation
 * primitive: its only dependencies are its two inputs and its one output, so the loans feature does not reach into the clients feature for it and neither family owns it (AAP 0.4.2 `shared/`; AAP 0.11.1). */
@Component({
  selector: 'app-tab-strip',
  templateUrl: './tab-strip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabStripComponent {
  /** The tabs to render, in the parent's order. The parent owns both the ids and the labels. */
  readonly tabs = input.required<readonly TabDescriptor[]>();

  /** The id of the tab currently shown; the parent owns it and this component only reflects it. */
  readonly activeId = input.required<string>();

  /** Emits the chosen tab's id, and only when the chosen tab is not already active. */
  readonly tabChange = output<string>();

  /** {@link tabDomId} as the template uses it, so the id a tab element carries and the id a record template gives its panel's `aria-labelledby` come from the same function. */
  protected readonly tabDomId = tabDomId;

  /** Reports the tab the user picked, unless it is already the active one, and cancels the default of every activation it acts on. The template binds this to the tab's click and to its keydown, because a tab is deliberately not a link: an
   * `href`-less anchor navigates nowhere, so the default is cancelled only to keep a click from reaching the page, and the browser activates nothing of its own on Enter or the space bar. A keydown is therefore acted on only when its key is Enter or
   * the space bar, and every other key is returned from untouched, so the page keeps its own shortcuts and the space bar still scrolls the record while focus is on a tab (Rule 1 clause 3). @param event the click, or the keydown, that asked for the
   * tab. @param tab the descriptor of the tab the event happened on. */
  select(event: Event, tab: TabDescriptor): void {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();

    if (tab.id === this.activeId()) {
      return;
    }

    this.tabChange.emit(tab.id);
  }
}
