import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionsService } from '../../../../core/auth/permissions.service';
import { ActionButtonGroupComponent, type ClientActionButton } from './action-button-group.component';

/**
 * Behavioural spec for the client record's joined action group — the `ActionButtonGroup` row of the
 * component inventory (AAP 0.2.3), an element of the record screen in the "Sign in and open a client
 * record" flow (Figma node `1:4`), together with the `More` dropdown that closes it (AAP 0.7.4;
 * Rule 1 clause 8, "tests prove behaviour").
 *
 * What the suite drives is the component's public surface and the DOM it paints: the eight action
 * links the record hands it, the route each one names, the gate that hides a link the user may not
 * use, the `More` menu's open and closed position under the pointer and the keyboard, and the two
 * computeds that publish the row/menu split and the "is anything permitted?" answer.
 *
 * The permission gate and the translation pipe are the real ones: `HasPermissionDirective` is what
 * decides every link's visibility, so the assertions read the inline `display` style the application
 * ships rather than a stub's verdict, and `TranslatePipe` resolves each label through the
 * `TranslateService` stub below. `PermissionsService` is stubbed at its own token, so this spec owns
 * the granted list exactly as a session would (Rule 1 clause 5 — nothing here calls a service that
 * reaches the network).
 */

/**
 * The descriptors the client record supplies, in its own order — the four row entries followed by the
 * four lifecycle commands of the `More` menu, with the label keys, glyphs and permission codes
 * `client-view.component.ts` builds them from (AAP 0.7.4; `app/scripts/models/clientStatus.js`). The
 * component knows none of these values, which is what keeps the plan's action set in one place.
 */
const ACTIONS: readonly ClientActionButton[] = [
  {
    label: 'label.button.edit',
    icon: 'fa-edit',
    permission: 'UPDATE_CLIENT',
    routerLink: '/editclient/1',
  },
  {
    label: 'label.button.newloan',
    icon: 'fa-plus',
    permission: 'CREATE_LOAN',
    routerLink: '/newclientloanaccount/1',
  },
  {
    label: 'label.button.newsaving',
    icon: 'fa-plus',
    permission: 'CREATE_SAVINGSACCOUNT',
    routerLink: '/new_client_saving_application/1',
  },
  {
    label: 'label.button.close',
    icon: 'fa-times-circle-o',
    permission: 'CLOSE_CLIENT',
    routerLink: '/client/1/close',
  },
  {
    label: 'label.button.activate',
    permission: 'ACTIVATE_CLIENT',
    routerLink: '/client/1/activate',
    menu: true,
  },
  {
    label: 'label.button.reject',
    permission: 'REJECT_CLIENT',
    routerLink: '/client/1/reject',
    menu: true,
  },
  {
    label: 'label.button.withdraw',
    permission: 'WITHDRAW_CLIENT',
    routerLink: '/client/1/withdraw',
    menu: true,
  },
  {
    label: 'label.button.reactivate',
    permission: 'REACTIVATE_CLIENT',
    routerLink: '/client/1/reactivate',
    menu: true,
  },
];

/** Every permission code {@link ACTIONS} names, so a case can grant the row the record renders. */
const EVERY_CODE: readonly string[] = ACTIONS.map((action) => action.permission);

/** The route each of the eight links names, in render order. */
const EVERY_HREF: readonly string[] = ACTIONS.map((action) => action.routerLink);

/**
 * The captions this component resolves, keyed exactly as the shipped flat legacy bundles key them
 * (`app/global-translations/`): a key that did not resolve would render humanised through the
 * missing-translation handler, so serving the real wording is what proves the labels resolve.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.button.edit': 'Edit',
  'label.button.newloan': 'New Loan',
  'label.button.newsaving': 'New Saving',
  'label.button.close': 'Close',
  'label.button.more': 'More',
  'label.button.activate': 'Activate',
  'label.button.reject': 'Reject',
  'label.button.withdraw': 'Withdraw',
  'label.button.reactivate': 'Reactivate',
};

/**
 * `PermissionsService` as the gate and the component's own computeds ask it: `has` is the question
 * `HasPermissionDirective` puts per entry, and `can` is the one the menu computeds put, so the stub
 * answers both from the same granted list and the two can never disagree here either.
 */
interface PermissionsStub {
  has(key: string): boolean;
  can(key: string): boolean;
}

/**
 * The ngx-translate surface this component touches: the `translate()` signal `TranslatePipe` 18
 * resolves its keys through, and the reads and event streams a real `TranslateService` carries, so
 * the stub stays the shape the sibling record spec provides. Nothing here reaches the network.
 */
interface TranslateStub {
  readonly currentLang: Signal<string>;
  instant(key: string): string;
  translate(key: string): Signal<string>;
  readonly onLangChange: unknown;
  readonly onTranslationChange: unknown;
}

/** Builds the translation stub the TestBed provides. */
function translateStub(): TranslateStub {
  return {
    currentLang: signal('en').asReadonly(),
    instant: (key: string): string => TRANSLATIONS[key] ?? key,
    translate: (key: string): Signal<string> => signal(TRANSLATIONS[key] ?? key),
    onLangChange: undefined,
    onTranslationChange: undefined,
  };
}

describe('ActionButtonGroupComponent', () => {
  /** The codes the session holds in the case being run; every stub answer is read from it. */
  let granted: Set<string>;

  beforeEach(async () => {
    granted = new Set(EVERY_CODE);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: TranslateService, useValue: translateStub() },
        {
          provide: PermissionsService,
          useValue: {
            has: (key: string): boolean => granted.has(key),
            can: (key: string): boolean => granted.has(key),
          } satisfies PermissionsStub,
        },
      ],
    });

    await TestBed.compileComponents();
  });

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines this
  // spec's only cast to one line and keeps the assertions type-checked (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  /**
   * Renders the group with the case's granted list, having installed it in `granted` first so the
   * gate and the computeds read the same session, and lets the queued effects settle before the
   * assertions paint.
   */
  async function renderRow(codes: readonly string[]): Promise<ComponentFixture<ActionButtonGroupComponent>> {
    granted = new Set(codes);

    const fixture = TestBed.createComponent(ActionButtonGroupComponent);

    fixture.componentRef.setInput('actions', ACTIONS);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Every action anchor the row renders, in render order: the four row entries then the menu's. */
  function actionLinks(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLAnchorElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLAnchorElement>('.btn-group a'));
  }

  /** The href of every action anchor, in render order. */
  function actionHrefs(fixture: ComponentFixture<ActionButtonGroupComponent>): (string | null)[] {
    return actionLinks(fixture).map((link) => link.getAttribute('href'));
  }

  /** The `href` of every anchor the user may actually use, in render order. */
  function visibleHrefs(fixture: ComponentFixture<ActionButtonGroupComponent>): (string | null)[] {
    return actionLinks(fixture)
      .filter((link) => link.style.display !== 'none')
      .map((link) => link.getAttribute('href'));
  }

  /** The `More` trigger, or a named failure when the group rendered none. */
  function moreTrigger(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLButtonElement {
    const trigger = host(fixture).querySelector<HTMLButtonElement>('.btn-group .dropdown-toggle');

    if (trigger === null) {
      throw new Error('ActionButtonGroupComponent rendered no More trigger');
    }

    return trigger;
  }

  /** The `btn-group` the `open` class is bound to: the trigger's own wrapper, not the outer row. */
  function moreGroup(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLElement {
    const group = moreTrigger(fixture).closest('.btn-group');

    if (!(group instanceof HTMLElement)) {
      throw new Error('the More trigger is not inside its own btn-group');
    }

    return group;
  }

  /** Lets the queued effects settle, then paints, which is what one interaction produces. */
  async function settle(fixture: ComponentFixture<ActionButtonGroupComponent>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders the eight in-scope actions in the parent’s order, each linking to its own route', async () => {
    const fixture = await renderRow(EVERY_CODE);

    expect(actionHrefs(fixture)).toEqual([...EVERY_HREF]);

    // The row entries are the design's joined primary buttons and the menu's four are menu items,
    // which is the markup legacy's record renders and Bootstrap 3 styles.
    const links = actionLinks(fixture);

    expect(links.slice(0, 4).every((link) => link.classList.contains('btn-primary'))).toBe(true);
    expect(links.slice(4).every((link) => link.getAttribute('role') === 'menuitem')).toBe(true);
  });

  it('renders every action and hides each one when the user holds no code', async () => {
    const fixture = await renderRow([]);
    const links = actionLinks(fixture);

    // The rows and the trigger exist exactly as legacy rendered them; only their visibility differs
    // (Rule 1 clause 3 — the gate hides an element, it never removes it).
    expect(links).toHaveLength(ACTIONS.length);
    expect(links.every((link) => link.style.display === 'none')).toBe(true);
    expect(moreTrigger(fixture)).not.toBeNull();
  });

  it('shows the one action whose permission the user holds', async () => {
    const fixture = await renderRow(['CLOSE_CLIENT']);

    expect(visibleHrefs(fixture)).toEqual(['/client/1/close']);
  });

  it('opens the More menu on the trigger and closes it again on the next click', async () => {
    const fixture = await renderRow(EVERY_CODE);

    expect(moreGroup(fixture).classList.contains('open')).toBe(false);

    moreTrigger(fixture).click();
    await settle(fixture);

    expect(moreGroup(fixture).classList.contains('open')).toBe(true);
    expect(moreTrigger(fixture).getAttribute('aria-expanded')).toBe('true');

    moreTrigger(fixture).click();
    await settle(fixture);

    expect(moreGroup(fixture).classList.contains('open')).toBe(false);
    // The outer group is not the element carrying the open position, so Bootstrap lays the row out
    // unchanged whether the menu is open or closed.
    expect(host(fixture).children[0]?.classList.contains('open')).toBe(false);
  });

  it('closes the More menu on Escape inside it, without opening it again', async () => {
    const fixture = await renderRow(EVERY_CODE);

    moreTrigger(fixture).click();
    await settle(fixture);

    expect(moreGroup(fixture).classList.contains('open')).toBe(true);

    moreGroup(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);

    expect(moreGroup(fixture).classList.contains('open')).toBe(false);
    expect(moreTrigger(fixture).getAttribute('aria-expanded')).toBe('false');
  });

  it('splits the eight descriptors four into the row and four into the menu, in the parent’s order', async () => {
    const fixture = await renderRow(EVERY_CODE);
    const component = fixture.componentInstance;

    expect(component.topLevelActions().map((action) => action.routerLink)).toEqual([
      '/editclient/1',
      '/newclientloanaccount/1',
      '/new_client_saving_application/1',
      '/client/1/close',
    ]);
    expect(component.menuActions().map((action) => action.routerLink)).toEqual([
      '/client/1/activate',
      '/client/1/reject',
      '/client/1/withdraw',
      '/client/1/reactivate',
    ]);
  });

  it('answers visibleMenuActions and hasMore from the permission list, entry by entry', async () => {
    const withoutCodes = await renderRow([]);

    // Nothing is permitted, but the menu still holds all four entries: filtering here is the
    // published answer, not the list the template renders.
    expect(withoutCodes.componentInstance.menuActions()).toHaveLength(4);
    expect(withoutCodes.componentInstance.visibleMenuActions()).toEqual([]);
    expect(withoutCodes.componentInstance.hasMore()).toBe(false);

    const withOneCode = await renderRow(['ACTIVATE_CLIENT']);

    expect(withOneCode.componentInstance.visibleMenuActions().map((action) => action.routerLink)).toEqual([
      '/client/1/activate',
    ]);
    expect(withOneCode.componentInstance.hasMore()).toBe(true);
  });
});
