import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PanelCardComponent } from '../../shared/panel-card/panel-card.component';

/**
 * Screen for an unknown hash path: what the router's `**` route in `app.routes.ts` selects, once
 * per unmatched URL. It is the counterpart of the legacy application's `.otherwise` fallback,
 * which renders `views/errors/404.html` for any route it does not define.
 *
 * Presentational only. It holds no state, injects no service and navigates nowhere by itself,
 * because an unmatched path must render identically for every user — signed out included — before
 * any route guard has run. All wording lives in the template and resolves through `TranslatePipe`,
 * so this class carries no copy; the visual treatment comes from the global Bootstrap 3 rules and
 * the legacy partials compiled into `styles.scss`, the card itself being the shared `PanelCard`
 * (AAP 0.2.3), which is why the component declares no styling.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, PanelCardComponent],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {}
