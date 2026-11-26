import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notifications/notification.service';
import { NotificationComponent } from './notification.component';

/** Behaviour of the application's single notification host (AAP 0.7.1 `NotificationComponent`, AAP 0.9.1 item 7): one `div.notification` per queued notice inside the widget's single `div.notification-container`, in queue (AAP 0.2.3, AAP 0.7.4, Rule 1 clause 3, AAP 0.1.1). */

/** Text chosen to expose tampering: mixed case, a comma-grouped number and a trailing full stop make capitalisation, trimming or truncation visible in the rendered notice. */
const SHORT_INFO = 'Saved.';
const LONG_ERROR =
  'The request failed: principal 50,000 exceeds the maximum allowed for this product.';

/** A message padded the way a Fineract `defaultUserMessage` or a legacy translation can be: leading and trailing spaces are part of the text the host was given, so the rendered notice has to keep both of them. */
const PADDED_INFO = '  Saved: 50,000.  ';

/** The one character the template's own markup contributes after the message: the line break that `notification.component.html` puts between `{{ message.message }}` and its closing `</div>`, which Angular's whitespace. */
const TEMPLATE_TAIL = ' ';

/** The close control's accessible name in the two bundles this suite serves, under the legacy key `label.button.close` (Rule 1 clause 6). */
const CLOSE_LABEL_EN = 'Close notice';
const CLOSE_LABEL_FR = 'Fermer la notification';

/** The legacy key the close control is named through; the shipped bundles already carry it. */
const CLOSE_LABEL_KEY = 'label.button.close';

/** The language the suite starts on, and the one a switch activates. */
const BASE_LANG = 'en';
const OTHER_LANG = 'fr';

/** Returns the notice's rendered text with its dismiss control removed, so the comparison measures only the message Fineract sent and not the close glyph the template also renders (AAP 0.5.2, AAP 0.7.4, Rule 1 clause 3). */
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
    // Reset first so every test starts on a fresh root injector and therefore an empty queue: a notice queued by one test must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NotificationComponent],
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    }).compileComponents();

    service = TestBed.inject(NotificationService);

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(BASE_LANG, { [CLOSE_LABEL_KEY]: CLOSE_LABEL_EN }, true);
    translate.setTranslation(OTHER_LANG, { [CLOSE_LABEL_KEY]: CLOSE_LABEL_FR }, true);
    await firstValueFrom(translate.use(BASE_LANG));

    fixture = TestBed.createComponent(NotificationComponent);
    // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here keeps the assertions below type-checked and confines the boundary cast to this line.
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

  it('renders no notice and no text while the queue is empty, and keeps its live region in place', () => {
    expect(service.messages()).toHaveLength(0);
    expect(host.querySelectorAll('.notification')).toHaveLength(0);
    expect((host.textContent ?? '').trim()).toBe('');

    expect(host.querySelectorAll('.notification-container')).toHaveLength(1);
    expect(host.querySelector('.notification-container')?.getAttribute('role')).toBe('alert');
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

  it('announces a notice from the container’s own live region rather than from the notice', () => {
    service.show('info', SHORT_INFO);
    service.show('error', LONG_ERROR);
    fixture.detectChanges();

    const container = host.querySelector<HTMLElement>('.notification-container');
    const notices = host.querySelectorAll<HTMLElement>('.notification');

    expect(container?.getAttribute('role')).toBe('alert');
    expect(container?.getAttribute('aria-live')).toBe('assertive');
    expect(container?.getAttribute('aria-atomic')).toBe('false');

    expect(notices).toHaveLength(2);
    expect(Array.from(notices, (notice) => notice.getAttribute('role'))).toEqual([null, null]);
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
    // Not the raw key: the accessible name is the active translation bundle's rendering of its key (AAP 0.1.1 requirement 1's i18n rule), never the key itself and never an English literal hard-coded in the component, so a language switch re-resolves it.
    expect(closeLabel(notices[0])).not.toBe(CLOSE_LABEL_KEY);
    expect(closeLabel(notices[0])).not.toBe('Dismiss');

    await firstValueFrom(translate.use(OTHER_LANG));
    fixture.detectChanges();

    // A switch is neither a navigation nor a re-render of the queue: the same two notices stay and only their control's accessible name changes (AAP 0.7.4 "without a page reload").
    const switched = host.querySelectorAll<HTMLElement>('.notification');

    expect(switched).toHaveLength(2);
    expect(closeLabel(switched[0])).toBe(CLOSE_LABEL_FR);
    expect(closeLabel(switched[1])).toBe(CLOSE_LABEL_FR);
    // The notice body is Fineract's own text and is never translated (Rule 1 clause 3).
    expect(renderedText(switched[0])).toBe(`${SHORT_INFO}${TEMPLATE_TAIL}`);
  });
});
