import { Injectable, signal, type Signal } from '@angular/core';

/** Severity of a queued notice: the three kinds the legacy widget renders as `.notification-info`, `.notification-success` and `.notification-error` (see `web-ng/src/styles.scss`), carried as data and mapped to those classes by the widget. */
export type NotificationKind = 'info' | 'success' | 'error';

/** One notice awaiting display by the application's single `NotificationComponent` host: `id` is monotonic and never reused, so two notices carrying identical text stay distinguishable in the template's `track`, and `message` holds Fineract's text verbatim. */
export interface NotificationMessage {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly message: string;
}

/** How long one notice stays on screen before it removes itself, in milliseconds. A notice must not outlive its relevance: a failure the user has already recovered from must stop being painted over the screen the recovered request produced, and a notice nobody closes must not accumulate over a working session. No legacy behaviour is being matched here — the `Notification` component is new (AAP 0.2.3) — so one lifetime serves every kind, and it is long enough to read a server message of a line or two without being dismissed mid-read. */
export const NOTICE_LIFETIME_MS = 8_000;

/** Holds the notices until the widget renders them: the write end of one edge, whose main caller is the interceptor's error mapping and whose only reader is the shared notification component. Every notice is queued with an expiry of `NOTICE_LIFETIME_MS`, so it leaves the list on its own as well as on its close control, and `clear()` — called on every finished navigation — retires both the notices and their pending expiries. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly queue = signal<readonly NotificationMessage[]>([]);

  /** The armed self-dismissal of each queued notice, keyed by the notice's id: exactly the queued notices have an entry, so `dismiss` and `clear` retire the timers of the notices they remove and a stale one can never fire against a list it no longer belongs to. */
  private readonly expiries = new Map<number, ReturnType<typeof setTimeout>>();

  private nextId = 0;

  /** The queued notices, oldest first, as an immutable snapshot the widget renders one element per entry from. */
  readonly messages: Signal<readonly NotificationMessage[]> = this.queue.asReadonly();

  /** Queues one notice at the end of the list, preserving insertion order, and arms its expiry; the text is stored exactly as received — no deduplication, prefix, translation or escaping — because the text shown must equal Fineract's. */
  show(kind: NotificationKind, message: string): void {
    const notice: NotificationMessage = { id: ++this.nextId, kind, message };

    this.publish([...this.queue(), notice]);
    this.armExpiry(notice.id);
  }

  /** Discards the single notice carrying `id`, leaving the rest in order; an id no longer queued changes nothing, keeping an unchanged list from re-rendering. Both the notice's close control and its expiry reach here, so the first of the two retires the timer and the second finds nothing left to retire. */
  dismiss(id: number): void {
    const current = this.queue();
    const remaining = current.filter((notice) => notice.id !== id);

    if (remaining.length === current.length) {
      return;
    }

    this.disarmExpiry(id);
    this.publish(remaining);
  }

  /** Empties the list, whether or not it holds notices, and retires every pending expiry with it: a notice removed here has no timer left to fire against the list that follows. */
  clear(): void {
    this.disarmAllExpiries();
    this.publish([]);
  }

  /** Arms the self-dismissal of the notice carrying `id`: `NOTICE_LIFETIME_MS` after it was shown, the notice leaves the queue by the same path its close control takes. The callback drops its own entry first, so a timer that has fired is a no-op the moment anything else has already removed the notice. */
  private armExpiry(id: number): void {
    const timer = setTimeout((): void => {
      this.expiries.delete(id);
      this.dismiss(id);
    }, NOTICE_LIFETIME_MS);

    this.expiries.set(id, timer);
  }

  /** Retires the pending expiry of the notice carrying `id`, so a notice dismissed by hand cannot be dismissed a second time by a timer left armed for it; a notice whose expiry already fired has no entry and nothing to cancel. */
  private disarmExpiry(id: number): void {
    const timer = this.expiries.get(id);

    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    this.expiries.delete(id);
  }

  /** Retires every pending expiry, which is what `clear()` needs: the list is replaced as a whole, so no timer armed for the old list may survive it. */
  private disarmAllExpiries(): void {
    for (const timer of this.expiries.values()) {
      clearTimeout(timer);
    }

    this.expiries.clear();
  }

  /** Publishes a frozen copy of `next`: freezing makes the `readonly` element type a runtime fact, and a fresh array hands the `OnPush` host a new signal value to render. */
  private publish(next: readonly NotificationMessage[]): void {
    this.queue.set(Object.freeze(next));
  }
}
