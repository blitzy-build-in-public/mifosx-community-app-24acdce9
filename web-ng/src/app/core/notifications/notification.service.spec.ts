import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTICE_LIFETIME_MS, NotificationService, type NotificationKind, type NotificationMessage,
} from './notification.service';

/** Behavioural spec for the queue the shared `NotificationComponent` renders and the HTTP interceptor's error mapping feeds. */
describe('NotificationService', () => {
  let service: NotificationService;

  /** One published snapshot, so a test asserts against a single state of the queue. */
  const queue = (): readonly NotificationMessage[] => service.messages();
  const texts = (): string[] => queue().map((notice) => notice.message);
  const ids = (): number[] => queue().map((notice) => notice.id);

  beforeEach(() => {
    service = new NotificationService();
  });

  /** Retires whatever a case left armed and puts the real clock back: a notice shown here carries a self-dismissal, and leaving a fake clock installed would hand the next case a queue that expires on a clock nobody advances. */
  afterEach(() => {
    service.clear();
    vi.useRealTimers();
  });

  it('queues notices in the order they are shown, keeping each kind', () => {
    const expectedKinds: readonly NotificationKind[] = ['info', 'error', 'success'];
    service.show('info', 'first');
    service.show('error', 'second');
    service.show('success', 'third');
    const notices = queue();
    expect(notices).toHaveLength(3);
    expect(texts()).toEqual(['first', 'second', 'third']);
    expect(notices.map((notice) => notice.kind)).toEqual(expectedKinds);
  });

  it('publishes a new frozen snapshot on every change and leaves the earlier one untouched', () => {
    // The `OnPush` host re-renders because the reference changes.
    const before = queue();
    expect(before).toHaveLength(0);
    service.show('info', 'Saved');
    const after = queue();
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(before).toHaveLength(0);
  });

  it('clears every notice, publishing a fresh empty snapshot and tolerating a second clear', () => {
    service.show('info', 'first');
    service.show('error', 'second');
    const before = queue();
    expect(before).toHaveLength(2);
    service.clear();
    const after = queue();
    expect(after).toHaveLength(0);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after).not.toBe(before);
    expect(() => service.clear()).not.toThrow();
    expect(queue()).toHaveLength(0);
  });

  it('keeps two notices carrying identical text apart by their id', () => {
    service.show('error', 'same');
    service.show('error', 'same');
    const notices = queue();
    expect(notices).toHaveLength(2);
    expect(texts()).toEqual(['same', 'same']);
    expect(notices[0].id).not.toBe(notices[1].id);
  });

  it('numbers each notice higher than the last, never reusing an id after a clear', () => {
    service.show('info', 'first');
    service.show('info', 'second');
    service.show('info', 'third');
    const issued = ids();
    const [first, second, third] = issued;
    expect(issued).toHaveLength(3);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);

    service.clear();
    service.show('info', 'after the clear');
    const afterClear = ids();
    expect(afterClear).toHaveLength(1);
    expect(afterClear[0]).toBeGreaterThan(third);
  });

  it('dismisses only the notice carrying the id, preserving the order of the rest', () => {
    service.show('info', 'first');
    service.show('error', 'second');
    service.show('success', 'third');
    const notices = queue();
    service.dismiss(notices[1].id);
    const remaining = queue();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((notice) => notice.message)).toEqual(['first', 'third']);
    expect(remaining.map((notice) => notice.id)).toEqual([notices[0].id, notices[2].id]);
    expect(Object.isFrozen(remaining)).toBe(true);
  });

  it('changes nothing when the dismissed id is not queued, so the host does not re-render', () => {
    service.show('info', 'only');
    const snapshot = queue();
    const neverIssuedId = Number.MAX_SAFE_INTEGER;
    expect(ids()).not.toContain(neverIssuedId);
    service.dismiss(neverIssuedId);

    expect(service.messages()).toBe(snapshot);
    expect(texts()).toEqual(['only']);
  });

  it('carries the message verbatim, with no trim, prefix or truncation', () => {
    // Workflow W7 compares the rendered text with Fineract's `errors[].defaultUserMessage` character for character.
    const serverMessage = '  The field Principal must be less than or equal to 10,000 ';
    service.show('error', serverMessage);
    const notices = queue();
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toBe(serverMessage);
  });

  it('writes nothing to the console, because a queued message may echo a field value', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      service.show('error', 'The field Principal must be less than or equal to 10,000');
      const notices = queue();
      service.dismiss(notices[0].id);
      service.show('info', 'Saved');
      service.clear();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  /** The lifetime every notice carries: a notice that nobody closes must leave on its own, because the host is a sibling of the router outlet and a failure the user has already recovered from must not stay painted. Each case runs on a fake clock, so a lifetime is advanced rather than waited out. */
  describe('the lifetime a notice carries', () => {
    it('dismisses the notice once NOTICE_LIFETIME_MS has elapsed, holding it until then', () => {
      vi.useFakeTimers();
      service.show('error', 'The request failed.');
      expect(texts()).toEqual(['The request failed.']);

      vi.advanceTimersByTime(NOTICE_LIFETIME_MS - 1);
      expect(texts()).toEqual(['The request failed.']);

      vi.advanceTimersByTime(1);
      expect(queue()).toHaveLength(0);
    });

    it('leaves no timer armed behind a notice that has already expired', () => {
      vi.useFakeTimers();
      service.show('info', 'Saved.');
      const [expired] = queue();

      vi.advanceTimersByTime(NOTICE_LIFETIME_MS);

      expect(queue()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      const emptied = queue();
      service.dismiss(expired.id);
      expect(queue()).toBe(emptied);
    });

    it('cancels only the dismissed notice’s timer, so the notices left keep their own lifetime', () => {
      vi.useFakeTimers();
      service.show('info', 'first');
      const [firstNotice] = queue();
      vi.advanceTimersByTime(2_000);
      service.show('error', 'second');
      expect(vi.getTimerCount()).toBe(2);

      service.dismiss(firstNotice.id);

      expect(texts()).toEqual(['second']);
      expect(vi.getTimerCount()).toBe(1);

      const afterDismiss = queue();
      vi.advanceTimersByTime(NOTICE_LIFETIME_MS - 2_000);
      expect(queue()).toBe(afterDismiss);
      expect(texts()).toEqual(['second']);

      // The notice that stayed keeps the whole lifetime from its own `show`, 2s after the dismissed one would have gone.
      vi.advanceTimersByTime(2_000 - 1);
      expect(texts()).toEqual(['second']);

      vi.advanceTimersByTime(1);
      expect(queue()).toHaveLength(0);
    });

    it('cancels every timer on clear, so nothing is published for a notice it removed', () => {
      vi.useFakeTimers();
      service.show('info', 'first');
      service.show('error', 'second');
      expect(vi.getTimerCount()).toBe(2);

      service.clear();
      const cleared = queue();

      expect(cleared).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(NOTICE_LIFETIME_MS * 2);

      expect(queue()).toBe(cleared);
    });
  });
});
