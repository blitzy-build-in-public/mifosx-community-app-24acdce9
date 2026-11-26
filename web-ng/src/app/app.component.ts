import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NotificationComponent } from './shared/notification/notification.component';

// Application root (AAP 0.8.2, AAP 0.11.1 row 12): the component `web-ng/src/main.ts` bootstraps and `web-ng/src/index.html` mounts as `<app-root>`, owning two hosts and nothing else - the router outlet and the (AAP 0.7.1, Rule 1 clause 5, AAP 0.4.1).
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {}
