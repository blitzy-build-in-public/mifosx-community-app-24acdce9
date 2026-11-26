import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PanelCardComponent } from '../../../../shared/panel-card/panel-card.component';

/**
 * One label/value row of the client record's profile card (AAP 0.2.3 component inventory
 * row `ProfileCard`, Figma screen `1:4`).
 *
 * A row whose `value` is empty renders its label with an empty value column instead of a
 * substitute placeholder, because the design shows rows carrying a label and no value
 * (AAP 0.7.4).
 */
export interface ProfileCardField {
  /** Row label, rendered in the card's bold key column. */
  readonly label: string;

  /** Row value as an already-formatted display string; empty renders an empty value column. */
  readonly value: string;
}

/**
 * Right-hand profile card of the individual client record: the client name as the card heading, the decorative
 * avatar, the label/value rows supplied by the parent, the performance-history sub-heading and the rows under it
 * (AAP 0.2.3 row `ProfileCard`, AAP 0.2.1 step 3).
 *
 * Presentational only: it issues no request, holds no state of its own and knows no `Client` model — the parent
 * resolves every value into a display string, so this component never formats a date, reads the clock or alters a
 * value it was given (AAP 0.4.2, 0.7.2, 0.14.1). It carries no copy either: the sub-heading resolves from the
 * legacy `label.heading.performancehistory` key through `TranslatePipe`, so it follows the active language and no
 * English text is inlined here (AAP 0.2.1 step 3, AAP 0.10.2; Rule 1 clause 6 reads the shipped bundle in place
 * rather than copying its text). Figma: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"), flow "Sign in and
 * open a client record", step 3 of 3 — Individual client view, screen `1:4` (its raster is node `17:9`).
 */
@Component({
  selector: 'app-profile-card',
  imports: [TranslatePipe, PanelCardComponent],
  templateUrl: './profile-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCardComponent {
  /** Client display name shown as the card heading (Figma screen `1:4`). */
  readonly displayName = input.required<string>();

  /** The card's rows, rendered in the order received. A row whose `value` is empty
   *  renders its label with an empty value column (AAP 0.7.4). */
  readonly fields = input.required<readonly ProfileCardField[]>();

  /**
   * The rows rendered under the card's `Performance History` sub-heading, in the order received.
   *
   * Optional and empty by default: the caller owns which rows exist, exactly as it does for
   * {@link fields}, so a caller with no history rows renders none. A row whose `value` is empty
   * renders its label beside an empty value column, which is what the legacy record paints for a
   * client whose summary the payload does not carry (AAP 0.7.4; Rule 1 clause 3).
   */
  readonly historyFields = input<readonly ProfileCardField[]>([]);

  /** Decorative client avatar, served from the legacy image tree through the `images/`
   *  entry of `angular.json` assets (AAP 0.2.4 asset inventory; the Figma file holds no
   *  exportable node for it). */
  protected readonly AVATAR_SRC = 'images/client-image-placeholder.png';
}
