import { Injectable, inject } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

import { AppConfigService } from '../config/app-config.service';

/** Milliseconds in a minute: `idleMinutes` and `keepaliveMinutes` arrive in minutes. */
const MS_PER_MINUTE = 60_000;

/** Milliseconds in a second: `warningSeconds` is the one duration that arrives in seconds. */
const MS_PER_SECOND = 1_000;

/**
 * The application's idle clock: the client-side reproduction of the legacy ng-idle triple —
 * a 30-minute idle duration, a 10-second warning and a 15-minute keepalive
 * (`app/scripts/modules/configurations.js:3-5`, wired through `$idleProvider.idleDuration`,
 * `$idleProvider.warningDuration` and `$keepaliveProvider.interval` at
 * `app/scripts/initialTasks.js:72-74`).
 *
 * **What it emits, and nothing more.** `start()` arms the schedule, `reset()` re-arms it from now,
 * `stop()` clears it. `warning$` fires `warningSeconds` before the idle duration elapses (29:50
 * under the shipped configuration) and `timeout$` fires when it does (30:00). The signed-in shell is
 * the only consumer: it renders the "you will be signed out" alert on the first emission and logs
 * out on the second (`app/scripts/controllers/main/MainController.js:139-143` logs out on
 * `$idleTimeout`). This class therefore knows nothing about sessions, routes, storage or HTTP — its
 * whole state is three timer handles and its whole output is two observables (AAP 0.7.1, core row
 * `IdleService`).
 *
 * **Emissions arrive from timer callbacks**, outside any component's change-detection pass, so a
 * zoneless consumer that has to re-render on them must hold them in a signal rather than a plain
 * field.
 *
 * **It issues no request, ever.** The legacy keepalive was purely client-side: the application
 * configured only the interval and never a `$keepaliveProvider.http(...)` option, and ng-idle 0.3.5's
 * Keepalive calls `$http` only when such an option exists. There is consequently no keepalive
 * endpoint to call, which is why this class injects no HTTP client and no router, and why this
 * behaviour is registered as a deliberate difference rather than a missing feature (AAP 0.10.5
 * item 10; AAP 0.9.4 row 8).
 *
 * **The keepalive does not postpone the idle deadline.** A heartbeat that re-armed the warning and
 * timeout timers would push both forward every `keepaliveMinutes`, so a tab the user never touches
 * would never reach its warning at all — and the legacy heartbeat could not postpone them either,
 * because ng-idle's Keepalive holds no reference to `$idle` and only `$idle`'s own DOM interrupts
 * reset its timer. What the legacy keepalive was observed to do once the session went idle is stop
 * (ng-idle halts it at `$idleStart` and restarts it on activity), which is what the schedule below
 * reproduces: the heartbeat runs while the session is in use and stops when the warning fires
 * (AAP 0.1.1, "a session with a 30-minute idle timeout, a 10-second warning before logout and a
 * 15-minute keepalive").
 *
 * **The durations are read in `start()`, never in a field initialiser.** `AppConfigService.config`
 * throws until `load()` has resolved, and the injector may construct this singleton before the
 * startup initialiser settles. Only `start()`, called by the shell — which exists only once the
 * configuration and the session are both in hand — is guaranteed to read a resolved value, so a
 * unit suite can construct the service with no configuration at all.
 *
 * **Handles are `window` timers, never `Date` arithmetic.** Each handle is the number the browser
 * returns, which is what `vi.useFakeTimers()` drives in the unit suite and what makes the schedule
 * measurable to the millisecond.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  /** The resolved configuration; read in `start()` for the three durations (AAP 0.4.4 decision 5). */
  private readonly appConfig = inject(AppConfigService);

  /**
   * The emissions themselves. Private, and never completed: the service outlives a logout, so a
   * `stop()` followed by a later `start()` has to reach subscribers that are still listening.
   */
  private readonly warningEvents = new Subject<void>();
  private readonly timeoutEvents = new Subject<void>();

  /**
   * Emits `warningSeconds` before the session goes idle — the shell shows its "you will be signed
   * out" alert for these. Emits once per idle period, and again only after `reset()` or `start()`
   * arms a new one.
   */
  readonly warning$: Observable<void> = this.warningEvents.asObservable();

  /**
   * Emits when the session has been idle for `idleMinutes` — the shell logs out and navigates to the
   * login screen. Emits once per idle period, so a duplicate logout cannot follow a single idle
   * stretch.
   */
  readonly timeout$: Observable<void> = this.timeoutEvents.asObservable();

  /** The pending warning timer, or `null` when no warning is scheduled. */
  private warningTimer: number | null = null;

  /** The pending timeout timer, or `null` when no timeout is scheduled. */
  private timeoutTimer: number | null = null;

  /** The pending keepalive heartbeat, or `null` when no heartbeat is scheduled. */
  private keepaliveTimer: number | null = null;

  /**
   * Arms the idle schedule from now: the warning, the timeout and the keepalive heartbeat.
   *
   * Called when a session is established — the legacy `$idle.watch()`
   * (`app/scripts/initialTasks.js:78`, and again from `scope.start()` at
   * `app/scripts/controllers/main/MainController.js:151-157`). Calling it while a schedule is
   * already armed replaces that schedule instead of doubling it, because `arm()` clears every handle
   * before it sets a new one.
   */
  start(): void {
    this.arm();
  }

  /**
   * Restarts the whole idle window from now: user activity, the warning's "stay signed in" action, a
   * route change — whatever the shell counts as the session being in use.
   *
   * It arms exactly what `start()` arms, so a reset can never leave one of the three timers on the
   * previous schedule.
   */
  reset(): void {
    this.arm();
  }

  /**
   * Clears every handle and leaves the service inert until the next `start()`. Called when the shell
   * is destroyed — logout, a 401, or the idle timeout that this service itself reported.
   */
  stop(): void {
    this.disarm();
  }

  /**
   * Reads the three durations and arms the schedule. The configuration is read **before** anything is
   * cleared: an unresolved configuration throws here, and leaving an armed schedule working is
   * strictly better than silently going inert because a read failed.
   */
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

  /**
   * The session has gone idle, so the heartbeat stops here — ng-idle's `stopKeepalive()` at
   * `$idleStart` — and the shell is told to show its warning. Only `start()` or `reset()` brings the
   * heartbeat back, and either of them restarts the whole window.
   */
  private raiseWarning(): void {
    this.stopKeepalive();
    this.warningEvents.next();
  }

  /**
   * The idle duration has elapsed. Everything is cleared before the emission, so a subscriber that
   * logs out synchronously inside its handler cannot race a second emission or a stray heartbeat.
   */
  private raiseTimeout(): void {
    this.disarm();
    this.timeoutEvents.next();
  }

  /**
   * Schedules the next keepalive heartbeat, `delayMs` from now, and arms nothing else.
   *
   * It makes no request — ng-idle's Keepalive reaches the network only through an `http` option the
   * legacy application never set (AAP 0.10.5 item 10) — and it deliberately leaves the warning and
   * timeout deadlines where they are: re-arming them would push the idle window forward by
   * `keepaliveMinutes` on every tick, so an untouched tab would never show its warning, and the
   * legacy heartbeat could not do that either. The heartbeat's lifecycle is the observable part:
   * it repeats while the session is in use and stops in `raiseWarning()` once the session goes idle,
   * which is exactly when ng-idle halts its own keepalive.
   *
   * It is also the single seam this class offers for a server-side keepalive: were one ever proven to
   * exist, its request would go here and nowhere else (AAP 0.9.4 row 8).
   */
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
