import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { NotificationService } from '../../core/notifications/notification.service';

/**
 * The application's single notification host (AAP 0.7.1 shared row `NotificationComponent`,
 * AAP 0.2.3 component inventory row `Notification`, AAP 0.9.1 item 1 "error and notification
 * display"). The app shell renders it once, above the routed content, so a message raised by any
 * screen — most often the interceptor's mapped Fineract error (AAP 0.4.2) — reaches the user
 * without that screen unmounting or losing its form state (AAP 0.7.4).
 *
 * It is a view of the queue and nothing more: it reads the queue published by
 * `NotificationService`, renders one element per notice, and clears the queue on dismissal. It
 * makes no HTTP call, holds no routing state, starts no timer, auto-hides nothing and declares no
 * styles — the widget's look comes from the global `.notification-*` rules of
 * `web-ng/src/styles.scss` (AAP 0.4.4 decision 4, Rule 1 clause 6). The notice text is Fineract's
 * own, so it is interpolated verbatim and never translated (Rule 1 clause 3).
 */
@Component({
  selector: 'app-notification',
  templateUrl: './notification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationComponent {
  /** The queue owner; the component reads its `messages` signal and calls only `clear()`. */
  private readonly notifications = inject(NotificationService);

  /**
   * The notices awaiting display, oldest first, bound directly as the read-only signal that
   * `NotificationService` publishes (AAP 0.7.1 key interface "binds
   * `NotificationService.messages()`"). Read through the signal rather than copied into local
   * state, so a notice queued from anywhere reaches this host and `OnPush` renders it.
   */
  protected readonly messages = this.notifications.messages;

  /**
   * Empties the queue: the template's close control calls this, and every visible notice goes at
   * once. Dropping a single notice stays the queue owner's concern
   * (`NotificationService.dismiss(id)`), never this host's.
   */
  protected dismiss(): void {
    this.notifications.clear();
  }
}
