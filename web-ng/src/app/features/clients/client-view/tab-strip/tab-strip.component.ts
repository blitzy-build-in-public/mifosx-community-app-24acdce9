import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** One entry of the client record's tab strip; the parent supplies both the id and the display label. */
export interface TabDescriptor {
  /** Stable identifier of the tab; opaque to this component, which only compares it for equality. */
  readonly id: string;
  /** Display text, shown verbatim: the parent owns the wording, so translation happens there. */
  readonly label: string;
}

/** The tab strip of the individual client record — the `TabStrip` row of the component inventory (AAP 0.2.3), an element of the client view screen in the "Sign in and open a client record" flow (Figma node `1:4`, file. */
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

  /** Reports the tab the user picked, unless it is already the active one. */
  select(event: Event, tab: TabDescriptor): void {
    event.preventDefault();

    if (tab.id === this.activeId()) {
      return;
    }

    this.tabChange.emit(tab.id);
  }
}
