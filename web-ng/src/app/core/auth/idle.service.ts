import { Injectable, inject } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';

/** Milliseconds in a minute: `idleMinutes` and `keepaliveMinutes` arrive in minutes. */
const MS_PER_MINUTE = 60_000;

/** Milliseconds in a second: `warningSeconds` is the one duration that arrives in seconds. */
const MS_PER_SECOND = 1_000;

/** The application's idle clock, reproducing the legacy ng-idle triple — a 30-minute idle duration, a 10-second warning and a 15-minute keepalive (`app/scripts/modules/configurations.js:3-5`, `app/scripts/initialTasks.js:72-74`) — whose whole output is `warning$` and `timeout$` (AAP 0.7.1 `IdleService`); it issues no request, the legacy keepalive having been purely client-side, which is a registered deliberate difference (AAP 0.10.5 item 10, AAP 0.9.4 row 8). */
@Injectable({ providedIn: 'root' })
export class IdleService {
  /** The resolved configuration; read in `start()` for the three durations (AAP 0.4.4 decision 5). */
  private readonly appConfig = inject(AppConfigService);

  /** The emissions themselves: private and never completed, because the service outlives a logout and a later `start()` has to reach subscribers that are still listening. */
  private readonly warningEvents = new Subject<void>();
  private readonly timeoutEvents = new Subject<void>();

  /** Emits `warningSeconds` before the session goes idle — the shell's "you will be signed out" alert — once per idle period, and again only after `reset()` or `start()`. */
  readonly warning$: Observable<void> = this.warningEvents.asObservable();

  /** Emits once the session has been idle for `idleMinutes` — the shell logs out and returns to the login screen — once per idle period, so a duplicate logout cannot follow one idle stretch. */
  readonly timeout$: Observable<void> = this.timeoutEvents.asObservable();

  /** The pending warning timer, or `null` when no warning is scheduled. */
  private warningTimer: number | null = null;

  /** The pending timeout timer, or `null` when no timeout is scheduled. */
  private timeoutTimer: number | null = null;

  /** The pending keepalive heartbeat, or `null` when no heartbeat is scheduled. */
  private keepaliveTimer: number | null = null;

  /** Arms the idle schedule from now: the warning, the timeout and the keepalive heartbeat. Called when a session is established — legacy's `$idle.watch()` (`app/scripts/initialTasks.js:78`, `MainController.js:151-157`) — and replacing any schedule already armed rather than doubling it, because every handle is cleared before a new one is set. */
  start(): void {
    this.arm();
  }

  /** Restarts the whole idle window from now: user activity, the warning's "stay signed in" action, a route change. It arms exactly what `start()` arms, so a reset can never leave one of the three timers on the previous schedule. */
  reset(): void {
    this.arm();
  }

  /** Clears every handle and leaves the service inert until the next `start()`: logout, a 401, or the idle timeout this service itself reported. */
  stop(): void {
    this.disarm();
  }

  /** Reads the three durations and arms the schedule; the configuration is read before anything is cleared, so an unresolved read leaves an armed schedule working. */
  private arm(): void {
    const { idleMinutes, warningSeconds, keepaliveMinutes } = this.appConfig.config;
    const idleMs = idleMinutes * MS_PER_MINUTE;
    const warningMs = Math.max(idleMs - warningSeconds * MS_PER_SECOND, 0);

    this.disarm();

    this.warningTimer = window.setTimeout(() => {
      this.warningTimer = null;
      this.raiseWarning();
    }, warningMs);

    this.timeoutTimer = window.setTimeout(() => {
      this.timeoutTimer = null;
      this.raiseTimeout();
    }, idleMs);

    this.scheduleKeepalive(keepaliveMinutes * MS_PER_MINUTE);
  }

  /** Clears the three handles. Every handle is nulled, so `stop()` on a stopped service is a no-op. */
  private disarm(): void {
    if (this.warningTimer !== null) {
      window.clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }

    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    this.stopKeepalive();
  }

  /** The session has gone idle: the heartbeat stops here — ng-idle's own `stopKeepalive()` at `$idleStart` — and the shell is told to show its warning. */
  private raiseWarning(): void {
    this.stopKeepalive();
    this.warningEvents.next();
  }

  /** The idle duration has elapsed; everything is cleared before the emission, so a subscriber that logs out inside its handler cannot race a second emission. */
  private raiseTimeout(): void {
    this.disarm();
    this.timeoutEvents.next();
  }

  /** Schedules the next keepalive heartbeat and arms nothing else: it makes no request (AAP 0.10.5 item 10) and leaves the warning and timeout deadlines where they are, so an untouched tab still reaches its warning; it is also the single seam a server-side keepalive would use (AAP 0.9.4 row 8). */
  private scheduleKeepalive(delayMs: number): void {
    this.keepaliveTimer = window.setTimeout(() => {
      this.keepaliveTimer = null;
      this.scheduleKeepalive(delayMs);
    }, delayMs);
  }

  /** Cancels the pending heartbeat, if any. The session can then go idle without one running. */
  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      window.clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
