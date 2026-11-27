import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, type Event } from '@angular/router';
import { filter } from 'rxjs';

import { NotificationService } from './core/notifications/notification.service';
import { NotificationComponent } from './shared/notification/notification.component';

// Application root (AAP 0.8.2, AAP 0.11.1 row 12): the component `web-ng/src/main.ts` bootstraps and `web-ng/src/index.html` mounts as `<app-root>`, owning two hosts and nothing else - the router outlet and the notification host (AAP 0.7.1, Rule 1 clause 5, AAP 0.4.1).
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {
  /** The router whose finished navigations retire the notice queue, so the root subscribes to its event stream rather than a screen doing so. */
  private readonly router = inject(Router);

  /** The application's single notice queue — the same instance the notification host renders, which is why clearing it here reaches the widget. */
  private readonly notifications = inject(NotificationService);

  constructor() {
    // The notification host is a sibling of the router outlet rather than a child of the routed screen, so its queue outlives every screen that filled it: without this subscription a notice raised on one screen stays painted over the next one, and a failure message follows the user around after the failure has recovered. Every finished navigation therefore drops the queue — the notice has said what it had to say about the screen it belongs to, and a notice raised on the screen that just arrived is queued after it and kept.
    this.router.events
      .pipe(
        filter((event: Event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((): void => {
        this.notifications.clear();
      });
  }
}
