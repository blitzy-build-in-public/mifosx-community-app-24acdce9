import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { NotificationService } from '../../core/notifications/notification.service';

/** The application's single notification host (AAP 0.7.1 shared row `NotificationComponent`, AAP 0.2.3 component inventory row `Notification`, AAP 0.9.1 item 1 "error and notification display") (AAP 0.4.2, AAP 0.7.4, AAP 0.4.4, AAP 0.5.2). */
@Component({
  selector: 'app-notification',
  templateUrl: './notification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class NotificationComponent {
  /** The queue owner; the component reads its `messages` signal and calls only `dismiss(id)`. */
  private readonly notifications = inject(NotificationService);

  /** The notices awaiting display, oldest first, bound directly as the read-only signal that `NotificationService` publishes (AAP 0.7.1 key interface "binds `NotificationService.messages()`"). */
  protected readonly messages = this.notifications.messages;

  /** Drops exactly the notice carrying `id` — the one whose close control was clicked — by handing the id to the queue owner (`NotificationService.dismiss(id)`). */
  protected dismiss(id: number): void {
    this.notifications.dismiss(id);
  }
}
