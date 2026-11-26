import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
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
 * test is the one the HTTP interceptor feeds, and the real `TranslateService` rather than a stub, so
 * the close control's accessible name resolves through a bundle the way it does in the application.
 * The component adds nothing to the queue beyond rendering and per-notice dismissal, which is what
 * these tests assert: no auto-hide, no animation, no whole-queue clear and no translated notice body
 * (the body is Fineract's own text). The one string the component does translate — the close
 * control's name — is covered by the language case at the end (AAP 0.1.1 requirement 1, AAP 0.7.4).
 */

/**
 * Text chosen to expose tampering: mixed case, a comma-grouped number and a trailing full stop
 * make capitalisation, trimming or truncation visible in the rendered notice.
 */
const SHORT_INFO = 'Saved.';
const LONG_ERROR =
  'The request failed: principal 50,000 exceeds the maximum allowed for this product.';

/**
 * A message padded the way a Fineract `defaultUserMessage` or a legacy translation can be: leading
 * and trailing spaces are part of the text the host was given, so the rendered notice has to keep
 * both of them.
 */
const PADDED_INFO = '  Saved: 50,000.  ';

/**
 * The one character the template's own markup contributes after the message: the line break that
 * `notification.component.html` puts between `{{ message.message }}` and its closing `</div>`,
 * which Angular's whitespace handling collapses to a single space. It is named here rather than
 * trimmed away so every expectation below pins the rendered text to exactly what the host emits.
 */
const TEMPLATE_TAIL = ' ';

/**
 * The close control's accessible name in the two bundles this suite serves, under the legacy key
 * `label.button.close`.
 *
 * Distinct, synthetic values rather than the shipped "Close"/"Clôturer": what the case proves is that
 * the name comes from the active bundle and moves with the language, and writing the shipped wording
 * into a spec would copy translation text the build reads in place (Rule 1 clause 6). The key itself
 * is the shipped one — that is the point of reusing it rather than inventing one.
 */
const CLOSE_LABEL_EN = 'Close notice';
const CLOSE_LABEL_FR = 'Fermer la notification';

/** The legacy key the close control is named through; the shipped bundles already carry it. */
const CLOSE_LABEL_KEY = 'label.button.close';

/** The language the suite starts on, and the one a switch activates. */
const BASE_LANG = 'en';
const OTHER_LANG = 'fr';

/**
 * Returns the notice's rendered text with its dismiss control removed, so the comparison measures
 * only the message Fineract sent and not the close glyph the template also renders. Nothing is
 * trimmed: the message has to reach the host character for character (AAP 0.5.2 "Carries Fineract's
 * `defaultUserMessage` verbatim", AAP 0.7.4, Rule 1 clause 3), so a template or component that
 * trimmed it must fail here. The template's own trailing space is accounted for separately, in
 * `TEMPLATE_TAIL`.
 */
function renderedText(notice: HTMLElement): string {
  const dismiss = notice.querySelector('.close');
  dismiss?.remove();
  return notice.textContent ?? '';
}

describe('NotificationComponent', () => {
  let fixture: ComponentFixture<NotificationComponent>;
  let service: NotificationService;
  let translate: TranslateService;
  let host: HTMLElement;

  /** The accessible name the close control of `notice` reports, or `''` when none is rendered. */
  function closeLabel(notice: HTMLElement): string {
    return notice.querySelector<HTMLButtonElement>('.close')?.getAttribute('aria-label') ?? '';
  }

  beforeEach(async () => {
    // Reset first so every test starts on a fresh root injector and therefore an empty queue: a
    // notice queued by one test must never reach the next, and a second `configureTestingModule`
    // on an instantiated module throws.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NotificationComponent],
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    }).compileComponents();

    service = TestBed.inject(NotificationService);

    // Both bundles are seeded before the first render, so every case sees the close control's name
    // resolved rather than a raw key, exactly as the application does once a bundle has loaded.
    translate = TestBed.inject(TranslateService);
    translate.setTranslation(BASE_LANG, { [CLOSE_LABEL_KEY]: CLOSE_LABEL_EN }, true);
    translate.setTranslation(OTHER_LANG, { [CLOSE_LABEL_KEY]: CLOSE_LABEL_FR }, true);
    await firstValueFrom(translate.use(BASE_LANG));

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
    expect(renderedText(notices[0])).toBe(`${SHORT_INFO}${TEMPLATE_TAIL}`);
    expect(renderedText(notices[1])).toBe(`${LONG_ERROR}${TEMPLATE_TAIL}`);
  });

  it('renders a message carrying a leading and a trailing space character for character', () => {
    service.show('info', PADDED_INFO);
    fixture.detectChanges();

    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(notices).toHaveLength(1);
    expect(renderedText(notices[0])).toBe(`${PADDED_INFO}${TEMPLATE_TAIL}`);
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
    expect(renderedText(remaining[0])).toBe(`${LONG_ERROR}${TEMPLATE_TAIL}`);
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

  it('names the close control through the active bundle and follows a language switch', async () => {
    service.show('info', SHORT_INFO);
    service.show('error', LONG_ERROR);
    fixture.detectChanges();

    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(closeLabel(notices[0])).toBe(CLOSE_LABEL_EN);
    expect(closeLabel(notices[1])).toBe(CLOSE_LABEL_EN);
    // Not the raw key: the name resolved through the bundle rather than being echoed (AAP 0.1.1
    // requirement 1's i18n rule), and not the English literal the template used to carry.
    expect(closeLabel(notices[0])).not.toBe(CLOSE_LABEL_KEY);
    expect(closeLabel(notices[0])).not.toBe('Dismiss');

    await firstValueFrom(translate.use(OTHER_LANG));
    fixture.detectChanges();

    // A switch is neither a navigation nor a re-render of the queue: the same two notices stay and
    // only their control's accessible name changes (AAP 0.7.4 "without a page reload").
    const switched = host.querySelectorAll<HTMLElement>('.notification');

    expect(switched).toHaveLength(2);
    expect(closeLabel(switched[0])).toBe(CLOSE_LABEL_FR);
    expect(closeLabel(switched[1])).toBe(CLOSE_LABEL_FR);
    // The notice body is Fineract's own text and is never translated (Rule 1 clause 3).
    expect(renderedText(switched[0])).toBe(`${SHORT_INFO}${TEMPLATE_TAIL}`);
  });
});
