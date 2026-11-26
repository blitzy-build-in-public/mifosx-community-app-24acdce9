import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** One entry of the client record's tab strip; the parent supplies both the id and the display label. */
export interface TabDescriptor {
  /** Stable identifier of the tab; opaque to this component, which only compares it for equality. */
  readonly id: string;
  /** Display text, shown verbatim: the parent owns the wording, so translation happens there. */
  readonly label: string;
}

/**
 * The tab strip of the individual client record — the `TabStrip` row of the component inventory
 * (AAP 0.2.3), an element of the client view screen in the "Sign in and open a client record" flow
 * (Figma node `1:4`, file `DKm5TBFbXypfqyx4xUdhBw`).
 *
 * Presentational and controlled: it renders the descriptors its parent hands it, marks the one the
 * parent calls active, and reports a chosen tab. It holds no tab list of its own, so a tab the plan
 * keeps out of scope cannot appear here; and it neither navigates nor requests anything.
 */
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

  /**
   * Reports the tab the user picked, unless it is already the active one.
   *
   * One path serves the pointer and the keyboard: the anchor is legacy's own link — uib-tab 1.3.2
   * renders `<a href ng-click="select($event)">` — so a real Enter activates the focused tab here,
   * exactly as it does in legacy. The click's default is cancelled first and unconditionally, the
   * already-active tab included, because that valueless `href` would otherwise navigate to the
   * current URL and so change the hash route; the pager's `goToPage` cancels its own for the same
   * reason.
   *
   * @param event the anchor's click event, whose default navigation is suppressed.
   * @param tab the tab the user picked.
   */
  select(event: Event, tab: TabDescriptor): void {
    event.preventDefault();

    if (tab.id === this.activeId()) {
      return;
    }

    this.tabChange.emit(tab.id);
  }
}
