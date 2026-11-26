import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, type UrlTree } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FUNCTIONS, PermissionsService } from '../../../../core/auth/permissions.service';
import { ActionButtonGroupComponent, type ClientActionButton } from './action-button-group.component';

/** Behavioural spec for the client record's joined action group — the `ActionButtonGroup` row of the component inventory (AAP 0.2.3). */
/** The descriptors the client record supplies for client `1`, in its own order — the three row entries followed by the four lifecycle commands of the `More` menu, with the label keys. */
const ACTIONS: readonly ClientActionButton[] = [
  { label: 'label.button.edit', icon: 'fa-edit', permission: 'UPDATE_CLIENT', routerLink: '/editclient/1', },
  {
    label: 'label.button.newloan',
    icon: 'fa-plus',
    permission: 'CREATE_LOAN',
    routerLink: '/newclientloanaccount/1',
  },
  {
    label: 'label.button.close',
    icon: 'fa-times-circle-o',
    permission: 'CLOSE_CLIENT',
    routerLink: '/client/1/close',
  },
  { label: 'label.button.activate', permission: 'ACTIVATE_CLIENT', routerLink: '/client/1/activate', menu: true, },
  { label: 'label.button.reject', permission: 'REJECT_CLIENT', routerLink: '/client/1/reject', menu: true, },
  { label: 'label.button.withdraw', permission: 'WITHDRAW_CLIENT', routerLink: '/client/1/withdraw', menu: true, },
  {
    label: 'label.button.reactivate',
    permission: 'REACTIVATE_CLIENT',
    routerLink: '/client/1/reactivate',
    menu: true,
  },
];
/** Every permission code {@link ACTIONS} names, so a case can grant the whole row. */
const EVERY_CODE: readonly string[] = ACTIONS.map((action) => action.permission);
/** The route each row entry names, in render order. */
const ROW_HREFS: readonly string[] = ACTIONS.filter((action) => action.menu !== true).map(
  (action) => action.routerLink,
);
/** The route each `More` menu entry names, in render order. */
const MENU_HREFS: readonly string[] = ACTIONS.filter((action) => action.menu === true).map(
  (action) => action.routerLink,
);
/** The caption each row entry renders, in render order: the legacy bundle's wording, not the key. */
const ROW_LABELS: readonly string[] = ['Edit', 'New Loan', 'Close'];
/** The descriptors an **active** client's record supplies: `Edit`, `New Loan` and `Close` in the row and no menu entry at all (`app/scripts/models/clientStatus.js`; AAP 0.7.4). */
const ROW_ONLY_ACTIONS: readonly ClientActionButton[] = ACTIONS.filter(
  (action) => action.menu !== true,
);
/** The one descriptor a **closed** client's record supplies: `Reactivate`, in the menu (AAP 0.7.4; Rule 1 clause 3). */
const CLOSED_ONLY_ACTIONS: readonly ClientActionButton[] = ACTIONS.filter(
  (action) => action.routerLink === '/client/1/reactivate',
);
/** The wording of every key the component resolves, keyed as the shipped legacy bundles key them (`app/global-translations/`), so a raw dotted key would show. */
const TRANSLATIONS: Readonly<Record<string, string>> = {
  'label.button.edit': 'Edit',
  'label.button.newloan': 'New Loan',
  'label.button.close': 'Close',
  'label.button.more': 'More',
  'label.button.activate': 'Activate',
  'label.button.reject': 'Reject',
  'label.button.withdraw': 'Withdraw',
  'label.button.reactivate': 'Reactivate',
};
/** The controls the record keeps on the legacy screen and this migration never renders (AAP 0.10.5). */
const OUT_OF_SCOPE_LABELS: readonly string[] = ['Add Charge', 'Transfer Client', 'Assign Staff', 'Import Clients',];
/** Clicks `element` while suppressing the browser's default action, which jsdom cannot perform for a link and would report as an unimplemented navigation. */
function clickWithoutFollowingTheLink(element: HTMLElement): void {
  element.addEventListener('click', (event: Event): void => event.preventDefault(), { once: true });
  element.click();
}

describe('ActionButtonGroupComponent', () => {
  let permissions: PermissionsService;
  let router: Router;
  let httpMock: HttpTestingController;
  beforeEach(async () => {
    // Reset first so each case starts on a fresh root injector: a permission granted by one case must never reach the next, and a second `configureTestingModule` on an instantiated module throws.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ActionButtonGroupComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', fallbackLang: 'en' }),
      ],
    }).compileComponents();
    permissions = TestBed.inject(PermissionsService);
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');
  });
  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });
  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines this spec's only cast to one line and keeps every assertion type-checked (Rule 1 clause 4).
  const host = (fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLElement =>
    fixture.nativeElement as HTMLElement;
  /** The action row itself: the `.btn-group` the descriptors are rendered into. */
  function row(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLElement {
    const element: unknown = host(fixture).querySelector('.btn-group[role="group"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('ActionButtonGroupComponent rendered no action row');
    }
    return element;
  }
  /** The row's entries — the design's joined primary links — in the parent's order. */
  function rowEntries(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLAnchorElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLAnchorElement>('a.btn.btn-primary'));
  }
  /** The `More` menu's entries, in the parent's order, whether or not each one is usable. */
  function menuEntries(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLAnchorElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLAnchorElement>('.dropdown-menu a'));
  }
  /** The `More` menu's items, one per menu descriptor, each kept in place behind its own gate. */
  function menuItems(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLLIElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLLIElement>('.dropdown-menu li'));
  }
  /** The `More` trigger, or a named failure when the group rendered none. */
  function trigger(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLButtonElement {
    const element: unknown = host(fixture).querySelector('.dropdown-toggle');
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error('ActionButtonGroupComponent rendered no More trigger');
    }
    return element;
  }
  /** The `btn-group` carrying the open position: the trigger's own wrapper, not the outer row. */
  function dropdownGroup(fixture: ComponentFixture<ActionButtonGroupComponent>): HTMLElement {
    const group: unknown = trigger(fixture).closest('.dropdown');
    if (!(group instanceof HTMLElement)) {
      throw new Error('the More trigger is not inside its own dropdown group');
    }
    return group;
  }
  /** The entry naming `href`, or a named failure when the group rendered none. */
  function entryByHref(
    fixture: ComponentFixture<ActionButtonGroupComponent>,
    href: string,
  ): HTMLAnchorElement {
    const element: unknown = host(fixture).querySelector(`a[href="${href}"]`);
    if (!(element instanceof HTMLAnchorElement)) {
      throw new Error(`ActionButtonGroupComponent rendered no entry for ${href}`);
    }
    return element;
  }
  /** The hrefs of the entries the user may actually use, in render order. */
  function usableHrefs(entries: readonly HTMLAnchorElement[]): (string | null)[] {
    return entries.filter((entry) => entry.style.display !== 'none')
      .map((entry) => entry.getAttribute('href'));
  }
  /** Lets the queued effects settle, then paints, which is what one interaction produces. */
  async function settle(fixture: ComponentFixture<ActionButtonGroupComponent>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  /** Renders the group with the permission list a login would have supplied and, where a case needs a different set, its own descriptors, then settles. The list reaches the gate and the component's computeds through the real service, so both read one list. */
  async function render(
    codes: readonly string[],
    actions: readonly ClientActionButton[] = ACTIONS,
  ): Promise<ComponentFixture<ActionButtonGroupComponent>> {
    permissions.setPermissions(codes);
    const fixture = TestBed.createComponent(ActionButtonGroupComponent);
    fixture.componentRef.setInput('actions', actions);
    await settle(fixture);
    return fixture;
  }
  it('renders one joined primary link per row descriptor, in the parent’s order', async () => {
    const fixture = await render(EVERY_CODE);
    const entries = rowEntries(fixture);
    expect(entries).toHaveLength(ROW_HREFS.length);
    expect(entries.map((entry) => entry.getAttribute('href'))).toEqual([...ROW_HREFS]);
    expect(entries.map((entry) => entry.textContent?.trim() ?? '')).toEqual([...ROW_LABELS]);
    // The design's joined group: every row entry is the legacy record's `.btn.btn-primary` link.
    expect(
      entries.every(
        (entry) => entry.classList.contains('btn') && entry.classList.contains('btn-primary'),
      ),
    ).toBe(true);
    // The menu's entries are not part of the row, and the row's only button is the `More` trigger.
    expect(menuEntries(fixture)).toHaveLength(MENU_HREFS.length);
    expect(row(fixture).querySelectorAll('button')).toHaveLength(1);
    expect(trigger(fixture).getAttribute('type')).toBe('button');
  });
  it('navigates to the route each row entry names when that entry is clicked', async () => {
    const fixture = await render(EVERY_CODE);
    const navigations: string[] = [];
    const navigate = vi.spyOn(router, 'navigateByUrl')
      .mockImplementation((url: string | UrlTree): Promise<boolean> => {
        navigations.push(typeof url === 'string' ? url : router.serializeUrl(url));
        return Promise.resolve(true);
      });
    for (const entry of rowEntries(fixture)) {
      clickWithoutFollowingTheLink(entry);
      await settle(fixture);
    }
    // One navigation per click, each to the route its own descriptor names: the row is the record's navigation surface and carries no command of its own (AAP 0.14.1).
    expect(navigations).toEqual([...ROW_HREFS]);
    expect(navigate).toHaveBeenCalledTimes(ROW_HREFS.length);
  });
  it('hides an entry the user may not use without removing it, and reveals it when the permission arrives', async () => {
    const fixture = await render(['READ_CLIENT']);
    const hidden = entryByHref(fixture, '/newclientloanaccount/1');
    // Hidden, not removed, and still the entry it was: legacy's gate toggled visibility and kept the element in place, which is what the surrounding Bootstrap 3 layout was built around.
    expect(hidden.style.display).toBe('none');
    expect(hidden.isConnected).toBe(true);
    expect(hidden.textContent?.trim()).toBe('New Loan');
    permissions.setPermissions(['READ_CLIENT', 'CREATE_LOAN']);
    await settle(fixture);
    expect(entryByHref(fixture, '/newclientloanaccount/1').style.display).not.toBe('none');
    expect(entryByHref(fixture, '/editclient/1').style.display).toBe('none');
  });
  it('shows every row entry and every menu entry while ALL_FUNCTIONS is held', async () => {
    const fixture = await render([ALL_FUNCTIONS]);
    const entries = [...rowEntries(fixture),...menuEntries(fixture)];
    // The super-user wildcard answers every code, and it reaches this component through the same `can`/`has` question the route guard asks (AAP 0.7.1), so nothing is left hidden.
    expect(entries).toHaveLength(ACTIONS.length);
    expect(entries.every((entry) => entry.style.display !== 'none')).toBe(true);
    expect(fixture.componentInstance.hasMore()).toBe(true);
  });
  it('offers no usable menu entry while the user holds no lifecycle code', async () => {
    // `CREATE_LOAN` is a row code, so New Loan is usable while every `More` entry — all of which name lifecycle codes — is not.
    const fixture = await render(['CREATE_LOAN']);
    expect(trigger(fixture).style.display).not.toBe('none');
    expect(menuEntries(fixture)).toHaveLength(MENU_HREFS.length);
    expect(menuEntries(fixture).every((entry) => entry.style.display === 'none')).toBe(true);
    expect(fixture.componentInstance.visibleMenuActions()).toEqual([]);
    expect(fixture.componentInstance.hasMore()).toBe(false);
    expect(entryByHref(fixture, '/newclientloanaccount/1').style.display).not.toBe('none');
  });
  it('gates the menu entry by entry, keeping the entries the user may not use in place', async () => {
    const fixture = await render(['ACTIVATE_CLIENT', 'REJECT_CLIENT']);
    const entries = menuEntries(fixture);
    expect(host(fixture).querySelector('.dropdown-toggle')).not.toBeNull();
    expect(entries.map((entry) => entry.getAttribute('href'))).toEqual([...MENU_HREFS]);
    expect(usableHrefs(entries)).toEqual(['/client/1/activate', '/client/1/reject']);
    // The entries left out are gated where they stand: the item and its link stay in the menu rather than being filtered away, which is the legacy arrangement and not an improvement on it.
    expect(menuItems(fixture)).toHaveLength(MENU_HREFS.length);
    expect(entryByHref(fixture, '/client/1/withdraw').style.display).toBe('none');
    expect(entryByHref(fixture, '/client/1/reactivate').style.display).toBe('none');
    expect(
      fixture.componentInstance.visibleMenuActions().map((action) => action.routerLink),
    ).toEqual(['/client/1/activate', '/client/1/reject']);
  });
  it('opens the More menu on the trigger, closes it on the next click, and navigates nowhere', async () => {
    const fixture = await render(EVERY_CODE);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const dropdown = dropdownGroup(fixture);
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    trigger(fixture).click();
    await settle(fixture);
    expect(dropdown.classList.contains('open')).toBe(true);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    trigger(fixture).click();
    await settle(fixture);
    expect(dropdown.classList.contains('open')).toBe(false);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(navigate).not.toHaveBeenCalled();
    httpMock.verify();
  });
  it('closes the More menu on Escape inside it, without opening it again', async () => {
    const fixture = await render(EVERY_CODE);
    trigger(fixture).click();
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(true);
    dropdownGroup(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),);
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(false);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
  });
  it('closes the More menu when a click lands outside the group', async () => {
    const fixture = await render(EVERY_CODE);
    trigger(fixture).click();
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(true);
    // Legacy's `More` menu was Bootstrap's dropdown, which closed on a click anywhere else on the page; the document listener the component's host block installs reproduces it without the plugin (Rule 1 clause 3, QA finding F11).
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(false);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps the More menu open when the click lands inside the group', async () => {
    const fixture = await render(EVERY_CODE);
    // The trigger's own click bubbles to the document as well, so a dismissal that did not test where the click landed would close the menu on the very click that opened it.
    trigger(fixture).click();
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(true);
    dropdownGroup(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(fixture);
    expect(dropdownGroup(fixture).classList.contains('open')).toBe(true);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
  });
  it('renders the descriptor’s Font Awesome glyph, and no glyph for an entry that names none', async () => {
    const fixture = await render(EVERY_CODE);
    const glyph = entryByHref(fixture, '/editclient/1').querySelector('i');
    expect(glyph?.getAttribute('class')).toBe('fa fa-edit');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(
      entryByHref(fixture, '/newclientloanaccount/1').querySelector('i')?.getAttribute('class'),
    ).toBe('fa fa-plus');
    expect(entryByHref(fixture, '/client/1/activate').querySelector('i')).toBeNull();
  });
  it('renders no control the plan keeps out of scope and no second action toolbar', async () => {
    const fixture = await render(EVERY_CODE);
    const text = host(fixture).textContent ?? '';
    // Client charges, transfer, staff assignment and bulk import stay on the legacy record (AAP 0.10.5 items 4, 5, 7 and 8); no descriptor names them, so none may be rendered here.
    for (const label of OUT_OF_SCOPE_LABELS) { expect(text).not.toContain(label); }
    const groups = Array.from(host(fixture).querySelectorAll<HTMLElement>('.btn-group'));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toBe(row(fixture));
    expect(groups[1]?.classList.contains('dropdown')).toBe(true);
    expect(host(fixture).querySelectorAll('a')).toHaveLength(ACTIONS.length);
    expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
  });
  it('renders every entry and hides all of them while the user holds no code', async () => {
    const fixture = await render([]);
    const entries = [...rowEntries(fixture),...menuEntries(fixture)];
    // The gate fails closed (AAP 0.1.1): a session holding nothing sees the record's own markup with every control hidden, rather than a row that renders nothing.
    expect(entries).toHaveLength(ACTIONS.length);
    expect(entries.every((entry) => entry.style.display === 'none')).toBe(true);
    expect(fixture.componentInstance.hasMore()).toBe(false);
  });
  it('splits the descriptors into the row and the menu in the parent’s order', async () => {
    const fixture = await render(EVERY_CODE);
    const component = fixture.componentInstance;
    expect(component.topLevelActions().map((action) => action.routerLink)).toEqual([...ROW_HREFS]);
    expect(component.menuActions().map((action) => action.routerLink)).toEqual([...MENU_HREFS]);
  });
  it('renders no More trigger when no descriptor belongs to the menu', async () => {
    const fixture = await render(EVERY_CODE, ROW_ONLY_ACTIONS);
    // An active client's own state answers no menu command, so the group renders the row alone rather than a trigger over an empty list (Rule 1 clause 3).
    expect(host(fixture).querySelector('.dropdown-toggle')).toBeNull();
    expect(host(fixture).querySelector('.dropdown-menu')).toBeNull();
    const groups = Array.from(host(fixture).querySelectorAll<HTMLElement>('.btn-group'));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toBe(row(fixture));
    expect(rowEntries(fixture).map((entry) => entry.getAttribute('href'))).toEqual([...ROW_HREFS]);
    expect(fixture.componentInstance.menuActions()).toEqual([]);
  });
  it('renders the menu alone when the record offers only a menu entry', async () => {
    const fixture = await render(EVERY_CODE, CLOSED_ONLY_ACTIONS);
    // A closed client's list is `Reactivate` alone, so the group is the dropdown and its single usable item, with no row entry above it (AAP 0.7.4; Rule 1 clause 3).
    expect(rowEntries(fixture)).toHaveLength(0);
    expect(menuEntries(fixture).map((entry) => entry.getAttribute('href'))).toEqual([
      '/client/1/reactivate',
    ]);
    expect(usableHrefs(menuEntries(fixture))).toEqual(['/client/1/reactivate']);
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(fixture.componentInstance.hasMore()).toBe(true);
  });
});
