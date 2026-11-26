import { Injectable, signal, type Signal } from '@angular/core';

/** Severity of a queued notice: the three kinds the legacy widget renders as `.notification-info`, `.notification-success` and `.notification-error` (see `web-ng/src/styles.scss`), carried as data and mapped to those classes by the widget. */
export type NotificationKind = 'info' | 'success' | 'error';

/** One notice awaiting display by the application's single `NotificationComponent` host: `id` is monotonic and never reused, so two notices carrying identical text stay distinguishable in the template's `track`, and `message` holds Fineract's text verbatim. */
export interface NotificationMessage {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
}

/** Holds the notices until the widget renders them: the write end of one edge, whose main caller is the interceptor's error mapping and whose only reader is the shared notification component. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly queue = signal<readonly NotificationMessage[]>([]);
  private nextId = 0;

  /** The queued notices, oldest first, as an immutable snapshot the widget renders one element per entry from. */
  readonly messages: Signal<readonly NotificationMessage[]> = this.queue.asReadonly();

  /** Queues one notice at the end of the list, preserving insertion order; the text is stored exactly as received — no deduplication, prefix, translation or escaping — because the text shown must equal Fineract's. */
  show(kind: NotificationKind, message: string): void {
    this.publish([...this.queue(), { id: ++this.nextId, kind, message }]);
  }

  /** Discards the single notice carrying `id`, leaving the rest in order; an id no longer queued changes nothing, keeping an unchanged list from re-rendering. */
  dismiss(id: number): void {
    const current = this.queue();
    const remaining = current.filter((notice) => notice.id !== id);

    if (remaining.length === current.length) {
      return;
    }

    this.publish(remaining);
  }

  /** Empties the list, whether or not it holds notices. */
  clear(): void {
    this.publish([]);
  }

  /** Publishes a frozen copy of `next`: freezing makes the `readonly` element type a runtime fact, and a fresh array hands the `OnPush` host a new signal value to render. */
  private publish(next: readonly NotificationMessage[]): void {
    this.queue.set(Object.freeze(next));
  }
}
