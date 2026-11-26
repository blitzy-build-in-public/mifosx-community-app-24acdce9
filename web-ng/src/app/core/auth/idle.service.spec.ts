/** Behavioural spec for `IdleService` — the client-side reproduction of the legacy ng-idle triple (30-minute idle duration, 10-second warning, 15-minute keepalive) that AAP 0.3.4 claim 8 inherits from the legacy session (AAP 0.7.1). */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../config/app-config.model';
import { AppConfigService } from '../config/app-config.service';
import { IdleService } from './idle.service';

/** Milliseconds in a minute, restated here so the arithmetic below is independent of the service's own. */
const MS_PER_MINUTE = 60_000;

/** Milliseconds in a second: `warningSeconds` is the one duration that arrives in seconds. */
const MS_PER_SECOND = 1_000;

/** The legacy idle duration in minutes (`IDLE_DURATION = 30 * 60` in the legacy configuration). */
const IDLE_MINUTES = 30;

/** The legacy warning in seconds (`WARN_DURATION = 10`). */
const WARNING_SECONDS = 10;

/** The legacy keepalive interval in minutes (`KEEPALIVE_INTERVAL = 15 * 60`). */
const KEEPALIVE_MINUTES = 15;

const IDLE_DELAY_MS = IDLE_MINUTES * MS_PER_MINUTE;

const WARNING_DELAY_MS = IDLE_DELAY_MS - WARNING_SECONDS * MS_PER_SECOND;

const KEEPALIVE_DELAY_MS = KEEPALIVE_MINUTES * MS_PER_MINUTE;

const TEN_MINUTES_MS = 10 * MS_PER_MINUTE;

/** The `AppConfigService` surface `IdleService` reads. */
class StubAppConfigService implements Pick<AppConfigService, 'config' | 'apiUrl'> {
  constructor(private readonly resolved: AppConfig) {}
  get config(): AppConfig {
    return this.resolved;
  }
  apiUrl(path: string): string {
    const resource = path.replace(/^\/+/, '');
    return `${this.resolved.apiBaseUrl}${this.resolved.apiPath}/${resource}`;
  }
}

/** The resolved configuration the harness supplies: the configuration the build ships with, carrying all eight `AppConfig` members, including the real `dateFormat` literal `'dd MMMM yyyy'` (Rule 1 clause 3). */
function configFor(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_APP_CONFIG, ...overrides };
}

/** What the two subscriptions recorded: the fake-clock instants at which each emission arrived. */
interface Emissions {
  readonly warnings: number[];
  readonly timeouts: number[];
}

/** One service instance under test, the fake-clock record of its emissions and its HTTP test client. */
interface Harness {
  readonly service: IdleService;
  readonly httpMock: HttpTestingController;
  readonly emissions: Emissions;
}

/** Every subscription this file opened, so `afterEach` can unsubscribe from the never-completing subjects. */
const openSubscriptions: Subscription[] = [];

/** Builds the real `IdleService` with its one dependency replaced, plus the `HttpTestingController` every Fineract-facing service is surrounded by, so the no-request case has a client to inspect. */
function createHarness(config: AppConfig): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AppConfigService, useValue: new StubAppConfigService(config) },
    ],
  });

  const service = TestBed.inject(IdleService);
  const httpMock = TestBed.inject(HttpTestingController);
  const emissions: Emissions = { warnings: [], timeouts: [] };
  const startedAt = Date.now();

  openSubscriptions.push(
    service.warning$.subscribe(() => emissions.warnings.push(Date.now() - startedAt)),
    service.timeout$.subscribe(() => emissions.timeouts.push(Date.now() - startedAt)),
  );

  return { service, httpMock, emissions };
}

describe('IdleService', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness(configFor());
  });

  afterEach(() => {
    for (const subscription of openSubscriptions.splice(0)) {
      subscription.unsubscribe();
    }

    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('the legacy 30 / 10 / 15 schedule', () => {
    it('emits nothing for the whole window before the warning', () => {
      const { service, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(WARNING_DELAY_MS - 1);

      expect(emissions.warnings).toEqual([]);
      expect(emissions.timeouts).toEqual([]);
    });

    it('emits warning$ at exactly 29:50', () => {
      const { service, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(WARNING_DELAY_MS);

      expect(emissions.warnings).toEqual([WARNING_DELAY_MS]);
      expect(emissions.timeouts).toEqual([]);
    });

    it('emits timeout$ at exactly 30:00 and the warning no second time', () => {
      const { service, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(IDLE_DELAY_MS);

      expect(emissions.warnings).toEqual([WARNING_DELAY_MS]);
      expect(emissions.timeouts).toEqual([IDLE_DELAY_MS]);

      vi.advanceTimersByTime(IDLE_DELAY_MS);

      expect(emissions.warnings).toHaveLength(1);
      expect(emissions.timeouts).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('re-arming the window', () => {
    it('moves both deadlines by a whole window when reset() runs at 10:00', () => {
      const { service, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(TEN_MINUTES_MS);
      service.reset();

      vi.advanceTimersByTime(WARNING_DELAY_MS - 1);
      expect(emissions.warnings).toEqual([]);
      expect(emissions.timeouts).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(emissions.warnings).toEqual([TEN_MINUTES_MS + WARNING_DELAY_MS]);
      expect(emissions.timeouts).toEqual([]);

      vi.advanceTimersByTime(WARNING_SECONDS * MS_PER_SECOND - 1);
      expect(emissions.timeouts).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(emissions.timeouts).toEqual([TEN_MINUTES_MS + IDLE_DELAY_MS]);
    });

    it('keeps the idle deadlines where start() put them while the heartbeat re-arms itself', () => {
      const { service, emissions } = harness;

      service.start();

      expect(vi.getTimerCount()).toBe(3);

      vi.advanceTimersByTime(KEEPALIVE_DELAY_MS);
      expect(emissions.warnings).toEqual([]);
      expect(emissions.timeouts).toEqual([]);
      expect(vi.getTimerCount()).toBe(3);

      vi.advanceTimersByTime(WARNING_DELAY_MS - KEEPALIVE_DELAY_MS);
      expect(emissions.warnings).toEqual([WARNING_DELAY_MS]);

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(IDLE_DELAY_MS - WARNING_DELAY_MS);
      expect(emissions.timeouts).toEqual([IDLE_DELAY_MS]);

      vi.advanceTimersByTime(KEEPALIVE_DELAY_MS * 2);
      expect(emissions.warnings).toHaveLength(1);
      expect(emissions.timeouts).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('replaces a running schedule when start() is called twice', () => {
      const { service, emissions } = harness;

      service.start();
      service.start();

      expect(vi.getTimerCount()).toBe(3);

      vi.advanceTimersByTime(WARNING_DELAY_MS);

      expect(emissions.warnings).toEqual([WARNING_DELAY_MS]);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('silences everything when stop() clears the schedule', () => {
      const { service, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(TEN_MINUTES_MS);
      service.stop();

      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(TEN_MINUTES_MS + 60 * MS_PER_MINUTE);

      expect(emissions.warnings).toEqual([]);
      expect(emissions.timeouts).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('the durations it runs on', () => {
    it('pins the legacy 30 / 10 / 15 triple as the shipped default', () => {
      expect(DEFAULT_APP_CONFIG).toMatchObject({
        idleMinutes: IDLE_MINUTES,
        warningSeconds: WARNING_SECONDS,
        keepaliveMinutes: KEEPALIVE_MINUTES,
      });

      expect(IDLE_DELAY_MS).toBe(1_800_000);
      expect(WARNING_DELAY_MS).toBe(1_790_000);
      expect(KEEPALIVE_DELAY_MS).toBe(900_000);
    });

    it('derives every deadline from the configured durations instead of hard-coding them', () => {
      const shortened = createHarness(
        configFor({ idleMinutes: 1, warningSeconds: 10, keepaliveMinutes: 1 }),
      );

      shortened.service.start();
      vi.advanceTimersByTime(50_000 - 1);
      expect(shortened.emissions.warnings).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(shortened.emissions.warnings).toEqual([50_000]);
      expect(shortened.emissions.timeouts).toEqual([]);

      vi.advanceTimersByTime(10_000 - 1);
      expect(shortened.emissions.timeouts).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(shortened.emissions.timeouts).toEqual([60_000]);
    });
  });

  describe('no network traffic', () => {
    it('issues no HTTP request across 45 minutes of fake time', () => {
      const { service, httpMock, emissions } = harness;

      service.start();
      vi.advanceTimersByTime(KEEPALIVE_DELAY_MS);
      vi.advanceTimersByTime(TEN_MINUTES_MS);
      service.reset();
      vi.advanceTimersByTime(20 * MS_PER_MINUTE);

      // Two heartbeats and a reset later the clock has spoken only through its two observables, and nothing at all was handed to the HTTP client: the keepalive reaches no server, which is the deliberate difference AAP 0.10.5.
      expect(emissions.warnings).toEqual([]);
      expect(httpMock.match(() => true)).toHaveLength(0);
      expect(httpMock.verify()).toBeUndefined();
    });
  });
});
