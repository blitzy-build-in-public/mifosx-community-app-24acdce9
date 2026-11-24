import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NotificationService,
  type NotificationKind,
  type NotificationMessage,
} from './notification.service';

/**
 * Behavioural spec for the queue the shared `NotificationComponent` renders and the HTTP
 * interceptor's error mapping feeds. The service has no injected dependency, so each test builds
 * its own instance: the queue and the id counter live in the instance, and no test may inherit
 * another test's notices or numbering.
 */
describe('NotificationService', () => {
  let service: NotificationService;

  /** One published snapshot, so a test asserts against a single state of the queue. */
  const queue = (): readonly NotificationMessage[] => service.messages();
  const texts = (): string[] => queue().map((notice) => notice.message);
  const ids = (): number[] => queue().map((notice) => notice.id);

  beforeEach(() => {
    service = new NotificationService();
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
    // The `OnPush` host re-renders because the reference changes, and freezing the published array
    // makes the `readonly` element type a runtime fact rather than a compile-time promise.
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
    // No deduplication: two identical server messages are two notices a user dismisses separately.
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

    // A stale template reference must never pick up a newer notice, so the counter keeps moving
    // across a `clear()` rather than restarting with the emptied queue.
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

    // Same reference, not merely equal contents: an unchanged snapshot is what keeps the widget
    // from re-rendering for a notice that does not exist.
    expect(service.messages()).toBe(snapshot);
    expect(texts()).toEqual(['only']);
  });

  it('carries the message verbatim, with no trim, prefix or truncation', () => {
    // Workflow W7 compares the rendered text with Fineract's `errors[].defaultUserMessage`
    // character for character, so surrounding spaces and the trailing space have to survive.
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
});
