import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** One label/value row of the client record's profile card (AAP 0.2.3 row `ProfileCard`, Figma screen `1:4`); an empty `value` paints an empty value column, never a placeholder (AAP 0.7.4). */
export interface ProfileCardField {
  /** Row label, rendered in the card's bold key column. */
  readonly label: string;
  /** Row value as an already-formatted display string; empty renders an empty value column. */
  readonly value: string;
}

/** The record's right-hand profile card: name heading, decorative avatar, the rows the parent supplies and the `Performance History` block — presentational, resolving every label and date from the parent or the active locale (AAP 0.2.3; Figma screen `1:4`). */
@Component({
  selector: 'app-profile-card',
  imports: [TranslatePipe],
  templateUrl: './profile-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCardComponent {
  /** Client display name shown as the card heading (Figma screen `1:4`). */
  readonly displayName = input.required<string>();
  /** The card's rows, rendered in the order received. A row whose `value` is empty renders its label with an empty value column (AAP 0.7.4). */
  readonly fields = input.required<readonly ProfileCardField[]>();
  /** The rows rendered under the `Performance History` sub-heading, in the order received; empty by default, and an empty `value` stays empty as the legacy record paints it (AAP 0.7.4). */
  readonly historyFields = input<readonly ProfileCardField[]>([]);

  /** Decorative client avatar, served from the legacy image tree through the `images/` entry of `angular.json` assets (AAP 0.2.4). */
  protected readonly AVATAR_SRC = 'images/client-image-placeholder.png';
}
