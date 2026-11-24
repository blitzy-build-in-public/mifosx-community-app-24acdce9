import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notifications/notification.service';
import { NotificationComponent } from './notification.component';

/**
 * Behaviour of the application's single notification host (AAP 0.7.1 `NotificationComponent`,
 * AAP 0.9.1 item 7): one `div.notification` per queued notice inside the widget's single
 * `div.notification-container`, in queue order, the notice's kind as its `notification-*` class
 * (AAP 0.2.3 component inventory row `Notification`), Fineract's own text rendered character for
 * character (AAP 0.7.4, Rule 1 clause 3), and a close control that drops exactly the notice it
 * belongs to.
 *
 * The suite injects the real root `NotificationService` rather than a stub, so the queue under
 * test is the one the HTTP interceptor feeds. The component adds nothing to it beyond rendering
 * and per-notice dismissal, which is all these tests assert: no auto-hide, no animation, no
 * whole-queue clear and no translation exist here to test (AAP 0.7.1).
 */

/**
 * Text chosen to expose tampering: mixed case, a comma-grouped number and a trailing full stop
 * make capitalisation, trimming or truncation visible in the rendered notice.
 */
const SHORT_INFO = 'Saved.';
const LONG_ERROR =
  'The request failed: principal 50,000 exceeds the maximum allowed for this product.';

/**
 * Returns the notice's rendered text with its dismiss control removed, so the comparison measures
 * only the message Fineract sent and not the close glyph the template also renders.
 */
function renderedText(notice: HTMLElement): string {
  const dismiss = notice.querySelector('.close');
  dismiss?.remove();
  return (notice.textContent ?? '').trim();
}

describe('NotificationComponent', () => {
  let fixture: ComponentFixture<NotificationComponent>;
  let service: NotificationService;
  let host: HTMLElement;

  beforeEach(async () => {
    // Reset first so every test starts on a fresh root injector and therefore an empty queue: a
    // notice queued by one test must never reach the next, and a second `configureTestingModule`
    // on an instantiated module throws.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NotificationComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    service = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(NotificationComponent);
    // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the
    // assertions below type-checked and confines the boundary cast to this line.
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders one notice per queued message, in queue order, each with its kind class and unchanged text', () => {
    service.show('info', SHORT_INFO);
    service.show('error', LONG_ERROR);
    fixture.detectChanges();

    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(host.querySelectorAll('.notification-container')).toHaveLength(1);
    expect(notices).toHaveLength(2);
    expect(notices[0].classList.contains('notification-info')).toBe(true);
    expect(notices[0].classList.contains('notification-error')).toBe(false);
    expect(notices[1].classList.contains('notification-error')).toBe(true);
    expect(notices[1].classList.contains('notification-info')).toBe(false);
    expect(renderedText(notices[0])).toBe(SHORT_INFO);
    expect(renderedText(notices[1])).toBe(LONG_ERROR);
  });

  it('maps the success kind to the notification-success class alone', () => {
    service.show('success', SHORT_INFO);
    fixture.detectChanges();

    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(notices).toHaveLength(1);
    expect(notices[0].classList.contains('notification-success')).toBe(true);
    expect(notices[0].classList.contains('notification-info')).toBe(false);
    expect(notices[0].classList.contains('notification-error')).toBe(false);
  });

  it('renders no notice and no text while the queue is empty', () => {
    expect(service.messages()).toHaveLength(0);
    expect(host.querySelectorAll('.notification')).toHaveLength(0);
    expect((host.textContent ?? '').trim()).toBe('');
  });

  it('drops exactly the notice whose close control was clicked, leaving the other still rendered', () => {
    service.show('info', SHORT_INFO);
    service.show('error', LONG_ERROR);
    fixture.detectChanges();

    const [first, second] = Array.from(host.querySelectorAll<HTMLElement>('.notification'));
    const dismiss = first.querySelector<HTMLButtonElement>('.close');

    expect(dismiss).not.toBeNull();

    dismiss?.click();
    fixture.detectChanges();

    const remaining = host.querySelectorAll<HTMLElement>('.notification');

    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(second);
    expect(host.querySelectorAll('.notification-info')).toHaveLength(0);
    expect(remaining[0].classList.contains('notification-error')).toBe(true);
    expect(renderedText(remaining[0])).toBe(LONG_ERROR);
    expect(service.messages()).toHaveLength(1);
    expect(service.messages()[0].message).toBe(LONG_ERROR);
  });

  it('marks every rendered notice with role="alert"', () => {
    service.show('info', SHORT_INFO);
    service.show('error', LONG_ERROR);
    fixture.detectChanges();

    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(notices).toHaveLength(2);
    expect(Array.from(notices, (notice) => notice.getAttribute('role'))).toEqual(['alert', 'alert']);
  });

  it('writes nothing to the console while rendering and dismissing a notice', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];

    service.show('error', LONG_ERROR);
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('.close')?.click();
    fixture.detectChanges();

    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);

    vi.restoreAllMocks();
  });
});
