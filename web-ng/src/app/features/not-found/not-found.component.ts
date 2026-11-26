import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Screen for an unknown hash path — what the router's `**` route selects, and the counterpart of legacy's `.otherwise` fallback: presentational only, with no state, service or navigation, because it must render for every user, signed out included, before any guard has run (Rule 1 clause 6). */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './not-found.component.html',
})
export class NotFoundComponent {}
