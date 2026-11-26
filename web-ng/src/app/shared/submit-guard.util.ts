import { signal, type Signal } from '@angular/core';

/** Duplicate-submission protection for the action screens (AAP 0.7.1 `shared/submit-guard.util.ts`, AAP 0.1.1 and 0.14.1 "one request per click", AAP 0.10.1 workflow W5's "one POST per action"). */

/** Handle returned by `createSubmitGuard`, one per actionable screen. */
export interface SubmitGuard {
  /** True while a guarded call is in flight; bind to the trigger's disabled state. */
  readonly busy: Signal<boolean>;
  /** Runs `fn` once; refuses re-entrance while busy and re-settles the busy signal in both outcomes. Resolves without invoking `fn` when a call is already in flight, and rethrows `fn`'s rejection so the screen renders the mapped Fineract message verbatim. */
  runOnce(fn: () => Promise<void>): Promise<void>;
}

/** Creates an independent guard, so one screen's busy state never disables another screen's action. It is built on `signal()` alone, which needs no injection context, so a component may hold its guard in a field initializer. */
export function createSubmitGuard(): SubmitGuard {
  const inFlight = signal(false);

  return {
    busy: inFlight.asReadonly(),
    async runOnce(fn: () => Promise<void>): Promise<void> {
      if (inFlight()) {
        return;
      }
      // Set before `fn` runs, so a synchronous re-entrant call is already refused.
      inFlight.set(true);
      try {
        await fn();
      } finally {
        inFlight.set(false);
      }
    }, };
}
