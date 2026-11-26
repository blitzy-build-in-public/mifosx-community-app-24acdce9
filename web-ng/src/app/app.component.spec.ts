import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppComponent } from './app.component';
import { NotificationService } from './core/notifications/notification.service';

/** Behaviour of the application root (AAP 0.11.1 row 12; AAP 0.8.2 "Application entry and configuration"): the component `web-ng/src/main.ts` bootstraps and `web-ng/src/index.html` mounts as `<app-root>` (AAP 0.7.1, AAP 0.14.1, AAP 0.4.1, AAP 0.1.1). */

/** Route target standing in for any screen the router may select. */
@Component({
  selector: 'app-routed-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p class="routed-marker">Routed screen</p>',
})
class RoutedStubComponent {}

/** The one route this suite registers and navigates to, as the root-relative segment the router commands and the route declaration share; the root template declares no route of its own. */
const ROUTED_PATH = 'routed-stub';

/** Marker the routed stub renders, so the outlet's output is distinguishable from the root's own. */
const ROUTED_TEXT = 'Routed screen';

/** Notice texts chosen to expose reordering or truncation: one short and one long, so queue order stays visible in the rendered stack. */
const INFO_NOTICE = 'Client saved.';
const ERROR_NOTICE =
  'The request failed: principal 50,000 exceeds the maximum allowed for this product.';

/** The bundle this suite seeds for the notification host's close control, whose accessible name is the one string inside the widget that is translated (AAP 0.1.1 requirement 1, AAP 0.7.4). */
const BASE_LANG = 'en';
const CLOSE_LABEL_BUNDLE: Record<string, string> = { 'label.button.close': 'Close' };

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let router: Router;
  let notifications: NotificationService;
  let host: HTMLElement;

  /** Activates the root-relative route named by `segment` through the real router and renders whatever the outlet created, in the same two steps the application takes after a navigation: the router resolves the route, then Angular renders the component the outlet activated (AAP 0.14.1). */
  async function navigateTo(segment: string): Promise<void> {
    await router.navigate([segment]);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    // Reset first so every test starts on a fresh root injector, and therefore on a fresh `NotificationService` queue and a fresh router: a notice queued or a route activated by one test must never reach the next, and a fresh injector per test is what guarantees it.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: ROUTED_PATH, component: RoutedStubComponent }]),
        provideTranslateService(),
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(BASE_LANG, CLOSE_LABEL_BUNDLE, true);
    await firstValueFrom(translate.use(BASE_LANG));

    router = TestBed.inject(Router);
    notifications = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(AppComponent);
    // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the assertions below type-checked and confines the boundary cast to this single line.
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('creates the component once, rendering no nested copy of itself', () => {
    expect(fixture.componentInstance).toBeInstanceOf(AppComponent);
    // `TestBed.createComponent` mounts the component on a host element of its own rather than on the `<app-root>` `src/index.html` supplies, so this asserts the component's *output*: an `app-root` element below it would mean the component rendered a nested copy of itself.
    expect(host.querySelectorAll('app-root')).toHaveLength(0);
  });

  it('renders exactly its two hosts — the router outlet and the single notification host — and no wrapper element', () => {
    const children = Array.from(host.children);

    expect(children.map((child) => child.tagName.toLowerCase())).toEqual([
      'router-outlet',
      'app-notification',
    ]);
    expect(host.querySelectorAll('app-notification')).toHaveLength(1);
    expect(host.querySelectorAll(':scope > app-notification')).toHaveLength(1);
    expect(host.querySelectorAll(':scope > router-outlet')).toHaveLength(1);
  });

  it('renders the component the router selects inside its router outlet', async () => {
    const outlet = fixture.debugElement.query(By.directive(RouterOutlet));

    expect(outlet).not.toBeNull();
    expect(host.querySelector('.routed-marker')).toBeNull();

    await navigateTo(ROUTED_PATH);

    const routed = host.querySelector<HTMLElement>('.routed-marker');

    expect(routed).not.toBeNull();
    expect(routed?.textContent?.trim()).toBe(ROUTED_TEXT);
    // `RouterOutlet` is a directive, so its instance comes from the queried element's injector; `isActivated` is what tells "the outlet rendered the route" from "the outlet is present but empty".
    expect(outlet?.injector.get(RouterOutlet).isActivated).toBe(true);
    expect(outlet?.injector.get(RouterOutlet).component).toBeInstanceOf(RoutedStubComponent);
  });

  it('renders no notice inside the notification host while the queue is empty', () => {
    expect(notifications.messages()).toHaveLength(0);
    expect(host.querySelectorAll('app-notification')).toHaveLength(1);
    expect(host.querySelectorAll('.notification')).toHaveLength(0);
  });

  it('renders one notice per queued message inside the single notification host, in queue order, each with its kind', () => {
    notifications.show('info', INFO_NOTICE);
    notifications.show('error', ERROR_NOTICE);
    fixture.detectChanges();

    const hosts = host.querySelectorAll<HTMLElement>('app-notification');
    const notices = hosts[0]?.querySelectorAll<HTMLElement>('.notification') ?? [];

    expect(Array.from(notifications.messages(), (notice) => notice.kind)).toEqual([
      'info',
      'error',
    ]);
    expect(hosts).toHaveLength(1);
    expect(notices).toHaveLength(2);
    expect(notices[0].classList.contains('notification-info')).toBe(true);
    expect(notices[0].classList.contains('notification-error')).toBe(false);
    expect(notices[0].textContent).toContain(INFO_NOTICE);
    expect(notices[1].classList.contains('notification-error')).toBe(true);
    expect(notices[1].classList.contains('notification-info')).toBe(false);
    expect(notices[1].textContent).toContain(ERROR_NOTICE);
  });

  it('keeps the notification host mounted outside the routed content, as a sibling of the router outlet', async () => {
    const before = host.querySelector('app-notification');

    expect(before).not.toBeNull();

    await navigateTo(ROUTED_PATH);

    const after = host.querySelector('app-notification');
    const outlet = host.querySelector('router-outlet');

    expect(after).toBe(before);
    expect(after?.parentElement).toBe(host);
    expect(after?.parentElement).toBe(outlet?.parentElement);
    expect(host.querySelector('app-routed-stub')).not.toBeNull();
    expect(after?.closest('app-routed-stub')).toBeNull();
    expect(host.querySelector('app-notification router-outlet')).toBeNull();
  });

  it('renders the route it navigated to, drops the notice raised before the navigation, and writes nothing to the console', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];

    notifications.show('error', ERROR_NOTICE);
    fixture.detectChanges();
    expect(host.querySelector('.notification-error')).not.toBeNull();

    await navigateTo(ROUTED_PATH);

    expect(host.querySelector('.routed-marker')).not.toBeNull();
    // The queue is a sibling of the outlet rather than a child of the routed screen, so a notice raised on the screen that was just left must not be painted over the next one.
    expect(notifications.messages()).toHaveLength(0);
    expect(host.querySelector('.notification-error')).toBeNull();
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);

    vi.restoreAllMocks();
  });

  it('keeps a notice raised after a navigation, because only the navigation event drops the queue', async () => {
    await navigateTo(ROUTED_PATH);

    notifications.show('error', ERROR_NOTICE);
    fixture.detectChanges();

    expect(host.querySelector('.routed-marker')).not.toBeNull();
    expect(notifications.messages()).toHaveLength(1);
    expect(host.querySelector('.notification-error')).not.toBeNull();
  });
});
