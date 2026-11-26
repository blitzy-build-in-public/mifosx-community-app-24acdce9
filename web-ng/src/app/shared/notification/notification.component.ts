import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { NotificationService } from '../../core/notifications/notification.service';

/**
 * The application's single notification host (AAP 0.7.1 shared row `NotificationComponent`,
 * AAP 0.2.3 component inventory row `Notification`, AAP 0.9.1 item 1 "error and notification
 * display"). The app shell renders it once, above the routed content, so a message raised by any
 * screen — most often the interceptor's mapped Fineract error (AAP 0.4.2) — reaches the user
 * without that screen unmounting or losing its form state (AAP 0.7.4).
 *
 * It is a view of the queue and nothing more: it reads the queue published by
 * `NotificationService`, renders one element per notice, and drops the single notice whose close
 * control was clicked. It makes no HTTP call, holds no routing state, starts no timer, auto-hides
 * nothing and declares no styles — the widget's look comes from the global `.notification-*`
 * rules of `web-ng/src/styles.scss`, which carry the `.notification-container` stack and the
 * per-kind accent bars the template emits (AAP 0.4.4 decision 4, AAP 0.5.2, Rule 1 clause 6). The
 * notice text is Fineract's own, so it is interpolated verbatim and never translated (Rule 1
 * clause 3).
 *
 * **The close control's accessible name is the one string here that is the application's own**, so it
 * is the one that resolves through the translation stack: the template binds it to the legacy
 * bundle's existing `label.button.close` key, which the shipped en/fr/es bundles already carry as
 * "Close", "Clôturer" and "Cerrar". A non-English user therefore hears the control named in the
 * language the interface is in, and no key is invented for it (AAP 0.1.1 requirement 1's i18n;
 * AAP 0.7.4; Rule 1 clauses 3 and 6).
 */
@Component({
  selector: 'app-notification',
  templateUrl: './notification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class NotificationComponent {
  /** The queue owner; the component reads its `messages` signal and calls only `dismiss(id)`. */
  private readonly notifications = inject(NotificationService);

  /**
   * The notices awaiting display, oldest first, bound directly as the read-only signal that
   * `NotificationService` publishes (AAP 0.7.1 key interface "binds
   * `NotificationService.messages()`"). Read through the signal rather than copied into local
   * state, so a notice queued from anywhere reaches this host and `OnPush` renders it.
   */
  protected readonly messages = this.notifications.messages;

  /**
   * Drops exactly the notice carrying `id` — the one whose close control was clicked — by handing
   * the id to the queue owner (`NotificationService.dismiss(id)`). Every other queued notice
   * stays on screen, in its original order; an id that is no longer queued leaves the list
   * untouched, so a stale click changes nothing.
   */
  protected dismiss(id: number): void {
    this.notifications.dismiss(id);
  }
}
