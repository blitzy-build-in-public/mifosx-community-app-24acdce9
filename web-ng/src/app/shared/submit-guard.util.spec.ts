import { describe, expect, it, vi } from 'vitest';

import { createSubmitGuard, type SubmitGuard } from './submit-guard.util';

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

/** A promise the test settles by hand, so the in-flight window can be observed. */
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe('submit-guard.util', () => {
  it('starts idle, so a fresh action button is enabled', () => {
    const guard: SubmitGuard = createSubmitGuard();

    expect(guard.busy()).toBe(false);
  });

  it('awaits the callback and leaves the guard idle, having called it once', async () => {
    const guard = createSubmitGuard();
    const pending = deferred();
    const action = vi.fn((): Promise<void> => pending.promise);

    const inFlight = guard.runOnce(action);

    pending.resolve();
    await inFlight;

    expect(action).toHaveBeenCalledTimes(1);
    expect(guard.busy()).toBe(false);
  });

  it('reports busy while the callback promise is pending', async () => {
    const guard = createSubmitGuard();
    const pending = deferred();
    const action = vi.fn((): Promise<void> => pending.promise);
    const inFlight = guard.runOnce(action);

    expect(guard.busy()).toBe(true);

    pending.resolve();
    await inFlight;

    expect(guard.busy()).toBe(false);
  });

  it('refuses re-entrance while busy, so the callback runs exactly once', async () => {
    const guard = createSubmitGuard();
    const pending = deferred();
    const action = vi.fn((): Promise<void> => pending.promise);

    const inFlight = guard.runOnce(action);
    const refused = guard.runOnce(action);

    await expect(refused).resolves.toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);

    pending.resolve();
    await inFlight;

    expect(action).toHaveBeenCalledTimes(1);
    expect(guard.busy()).toBe(false);
  });

  it('sends one request when the trigger is clicked twice in the same turn', async () => {
    const guard = createSubmitGuard();
    const request = vi.fn((): Promise<void> => Promise.resolve());

    // Both clicks arrive in the same microtask turn — the double-click case of AAP 0.10.1 W5.
    const first = guard.runOnce(request);
    const second = guard.runOnce(request);

    await Promise.all([first, second]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(guard.busy()).toBe(false);
  });

  it('rethrows a rejection to the caller and leaves the guard usable', async () => {
    const guard = createSubmitGuard();
    const failure = new Error('Loan account is not in a state to be approved');

    await expect(guard.runOnce(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(guard.busy()).toBe(false);

    const pending = deferred();
    const inFlight = guard.runOnce((): Promise<void> => pending.promise);

    expect(guard.busy()).toBe(true);

    pending.resolve();
    await inFlight;

    expect(guard.busy()).toBe(false);
  });

  it('keeps guards independent, so one screen never disables another', async () => {
    const first = createSubmitGuard();
    const second = createSubmitGuard();
    const pending = deferred();
    const inFlight = first.runOnce((): Promise<void> => pending.promise);
    const other = vi.fn((): Promise<void> => Promise.resolve());

    expect(first.busy()).toBe(true);
    expect(second.busy()).toBe(false);

    await second.runOnce(other);

    expect(other).toHaveBeenCalledTimes(1);
    expect(second.busy()).toBe(false);

    pending.resolve();
    await inFlight;

    expect(first.busy()).toBe(false);
  });

  it('schedules no timer, so one request per click needs no clock', async () => {
    vi.useFakeTimers();

    try {
      const guard = createSubmitGuard();
      const action = vi.fn((): Promise<void> => Promise.resolve());

      const inFlight = guard.runOnce(action);

      expect(vi.getTimerCount()).toBe(0);

      await inFlight;

      expect(action).toHaveBeenCalledTimes(1);
      expect(guard.busy()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
