import { Injectable, signal, type Signal } from '@angular/core';

/**
 * Severity of a queued notice: the three kinds the legacy widget renders as `.notification-info`,
 * `.notification-success` and `.notification-error` (see `web-ng/src/styles.scss`). The service
 * carries the kind as data only; the widget maps it to those classes.
 */
export type NotificationKind = 'info' | 'success' | 'error';

/**
 * One notice awaiting display by the application's single `NotificationComponent` host.
 *
 * `id` lets a template's `@for (... ; track notice.id)` tell apart two notices carrying identical
 * text; it is monotonic per service instance and never reused, not even after `dismiss` or
 * `clear`. `message` holds Fineract's text verbatim, so a server validation message reaches the
 * user character for character.
 */
export interface NotificationMessage {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
}

/**
 * Holds the notices the application has to show until the widget renders them: the write end of
 * one edge, whose main caller is the HTTP interceptor's error mapping and whose only reader is the
 * shared notification component. It makes no HTTP call, holds no routing or translation concern,
 * logs nothing and applies no styling, leaving the legacy look to the widget.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly queue = signal<readonly NotificationMessage[]>([]);
  private nextId = 0;

  /**
   * The queued notices, oldest first, as an immutable snapshot the widget renders one element per
   * entry from. A `Signal` rather than a writable signal, so no reader can bypass the methods.
   */
  readonly messages: Signal<readonly NotificationMessage[]> = this.queue.asReadonly();

  /**
   * Queues one notice at the end of the list, preserving insertion order. The text is stored
   * exactly as received — no deduplication (two identical errors are two notices, each with its
   * own id), no prefix, translation or escaping — because the text shown must equal Fineract's.
   */
  show(kind: NotificationKind, message: string): void {
    this.publish([...this.queue(), { id: ++this.nextId, kind, message }]);
  }

  /**
   * Discards the single notice carrying `id`, leaving the rest in order, so the widget's close
   * control can drop one message without clearing unrelated ones, as the legacy widget did per
   * message. An id no longer queued changes nothing, keeping an unchanged list from re-rendering.
   */
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

  /**
   * Publishes a frozen copy of `next`: freezing makes the `readonly` element type a runtime fact,
   * and a fresh array on every change hands the `OnPush` widget host a new signal value to render.
   */
  private publish(next: readonly NotificationMessage[]): void {
    this.queue.set(Object.freeze(next));
  }
}
