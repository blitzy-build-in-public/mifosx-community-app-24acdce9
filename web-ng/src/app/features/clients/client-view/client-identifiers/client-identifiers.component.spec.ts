import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { ApiError } from '../../../../core/http/api-error';
import {
  NotificationService,
  type NotificationKind,
  type NotificationMessage,
} from '../../../../core/notifications/notification.service';
import type { ClientIdentifier, ClientIdentifierTemplate } from '../../client.models';
import { ClientService } from '../../client.service';
import { ClientIdentifiersComponent } from './client-identifiers.component';

/**
 * Behavioural spec for the `Identities` tab of the individual client record — the read-only list of a
 * client's identity documents, loaded by `ClientIdentifiersComponent` from the two reads AAP 0.7.3 row
 * "W3 search and view client" assigns it (AAP 0.7.1 Features row `clients`, `ClientViewComponent`
 * with `ClientIdentifiersComponent`; AAP 0.7.4 `#/viewclient/:id`; AAP 0.11.1 "unit specs beside
 * every component"; Rule 1 clause 8).
 *
 * It pins the six things the tab exists to do and a rewrite would silently get wrong:
 *
 *  1. one `identifiers()` read per bound `clientId`, whose payload becomes one table row per document
 *     in the endpoint's own order, each cell carrying that document's own value;
 *  2. an empty payload renders the shared explicit empty state and no error — a client with no
 *     identity document is a successful answer, not a failure (AAP 0.7.4);
 *  3. a payload that already names every document type costs no `identifiersTemplate()` read, because
 *     a name that needs no resolution must not cost a second request (Rule 1 clause 2);
 *  4. documents that arrived with only their document type's id cost exactly one
 *     `identifiersTemplate()` read, and the name shown is the template's own for that id — never the
 *     numeric id, never a name this component invented (Rule 1 clauses 2 and 3);
 *  5. the tab is strictly read-only: no add, edit or delete affordance exists in its DOM, because the
 *     legacy tab offers none and this migration adds no capability legacy lacks (Rule 1 clause 3;
 *     AAP 0.10.5 item 6);
 *  6. a rejected read leaves the screen usable, raises no notification of its own and paints nothing
 *     for a failure the interceptor has already notified — while a 4xx, the one failure that
 *     interceptor does not notify, is painted verbatim in the tab's alert region (AAP 0.7.4,
 *     AAP 0.14.2);
 *
 * and one further guarantee the component's own load pipeline makes: rebinding `clientId` re-reads for
 * the new client and a response arriving for the previous one cannot overwrite it, which is what keeps
 * one client's documents from standing under another client's record (`switchMap` in the constructor).
 *
 * **What is deliberately not asserted.** Column headings are not checked: their wording belongs to the
 * legacy bundles in `app/global-translations/` and to the i18n spec that proves those keys resolve.
 * Nothing here is a request contract either — the endpoints, their query parameters and their bodies
 * are proven once, in `client.service.spec.ts` (Rule 1 clause 8, AAP 0.10.3 criterion 2).
 *
 * **Providers.** The data layer is stubbed at the `ClientService` token, so this spec exercises the
 * component's own behaviour and composes no URL: the tab's only collaborator is the clients family's
 * service, and the one HTTP factory, the tenant header and the error mapping all live behind it
 * (Rule 1 clause 5; AAP 0.4.2). A `NotificationService` stub is provided so the rejection case can
 * prove the tab raises no notice of its own. The ngx-translate stack is registered the way the
 * application installs it, because the template resolves its empty-state sentence through it.
 *
 * **Fixtures.** Every document key, description and status below is synthetic. Nothing here
 * reproduces tenant data, and no client id, document key or description is logged (Rule 1 clause 9).
 * The document types are served by the stubbed template read, because the types belong to the tenant
 * and are never constants in the application (Rule 1 clause 2).
 *
 * Figma provenance of the screen the tab belongs to: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2`
 * ("Legacy"), flow "Sign in and open a client record" — Login `1:5` → Clients list `1:3` →
 * Individual client view `1:4` (end of flow), `node_id` / `parent_screen_node_id` /
 * `figma_screen_id` all `1:4`. The captured frame has `General` active and paints no identifiers
 * table, so this spec asserts behaviour only: no pixel, colour or measurement appears in it.
 */

/** The client the tab is bound to — the `:id` of `#/viewclient/:id`, as the route delivers it. */
const CLIENT_ID = 2;

/** A second client, for the case that rebinds the input: another record must be read for. */
const OTHER_CLIENT_ID = 5;

/**
 * The legacy bundle's wording for the key the template hands the empty state
 * (`app/global-translations/locale-en.json`), served to the translate stack so the assertion below
 * compares the sentence a reader sees rather than a dotted key.
 */
const NO_DATA_KEY = 'label.nodata';

/** The same key's English wording in the shipped legacy bundle. */
const NO_DATA_TEXT = 'No Data';

/**
 * The one key the tab's empty state resolves. Its wording is the legacy bundle's own rather than a
 * sentence written for the empty table, so the assertion below pins the bundle's wording and the
 * absence of the raw key: this migration adds no copy the legacy app lacks (Rule 1 clauses 3 and 6).
 */
const EN_BUNDLE: Readonly<Record<string, string>> = { [NO_DATA_KEY]: NO_DATA_TEXT };

/**
 * Fineract's own text for a rejected identifier read, synthetic but shaped like the server's
 * `defaultUserMessage`: the tab renders it character for character (Rule 1 clause 3).
 */
const SERVER_FAILURE_TEXT = 'The document type is not active for this client.';

/** A document whose payload already carries its type's name: no resolution is needed for it. */
const PASSPORT: ClientIdentifier = {
  id: 41,
  documentType: { id: 1, name: 'Passport' },
  documentKey: 'P-99887766',
  description: 'Primary travel document',
  status: 'Active',
};

/** A second named document, so a case can prove the row count and the endpoint's order. */
const NATIONAL_ID: ClientIdentifier = {
  id: 42,
  documentType: { id: 2, name: 'National ID' },
  documentKey: 'ID-12345678',
  description: 'Issued at the head office',
  status: 'Active',
};

/**
 * A document the payload sent the type id for and a blank name, without a description or a status:
 * `ClientIdentifierTemplate` has to resolve the name, and both optional members must render as empty
 * cells rather than as the text `undefined` (Rule 1 clause 3).
 */
const UNNAMED_PASSPORT: ClientIdentifier = {
  id: 43,
  documentType: { id: 1, name: '' },
  documentKey: 'P-11223344',
};

/** A second document needing its name resolved, so one template read is proven to serve both. */
const UNNAMED_NATIONAL_ID: ClientIdentifier = {
  id: 44,
  documentType: { id: 2, name: '' },
  documentKey: 'ID-55667788',
  description: 'Renewed at the branch',
  status: 'Active',
};

/** The template's answer: the tenant's document types, in the order the endpoint returned them. */
const DOCUMENT_TYPES: ClientIdentifierTemplate = {
  allowedDocumentTypes: [
    { id: 1, name: 'Passport' },
    { id: 2, name: 'National ID' },
  ],
};

/** The identifiers read, typed to the service signature it stands in for. */
type IdentifiersStub = Mock<(id: number | string) => Observable<ClientIdentifier[]>>;

/** The document-type template read, typed to the service signature it stands in for. */
type IdentifiersTemplateStub = Mock<
  (id: number | string) => Observable<ClientIdentifierTemplate>
>;

/** The notification queue's write end, whose silence every failing case asserts. */
type NotificationShowStub = Mock<(kind: NotificationKind, message: string) => void>;

describe('ClientIdentifiersComponent', () => {
  let fixture: ComponentFixture<ClientIdentifiersComponent>;
  let component: ClientIdentifiersComponent;
  let identifiers: IdentifiersStub;
  let identifiersTemplate: IdentifiersTemplateStub;
  let notificationShow: NotificationShowStub;

  /**
   * The fixture's host element. `ComponentFixture.nativeElement` is loosely typed by Angular;
   * narrowing it once here keeps every DOM assertion below type-checked and confines the cast to a
   * single line (Rule 1 clause 4).
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Mounts the tab for one client and lets the load settle.
   *
   * The input is bound before the first change detection because the component reads from it as soon
   * as it is set: the effect that hands the id to the load pipeline runs in that first pass, and the
   * stubbed reads answer synchronously, so the second pass renders what the pass produced.
   */
  async function mount(clientId: number | string): Promise<void> {
    fixture = TestBed.createComponent(ClientIdentifiersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('clientId', clientId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Waits for a pass that is already in flight and renders its outcome. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The rendered document rows, in document order. */
  function renderedRows(): HTMLTableRowElement[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('tbody tr'));
  }

  /** Trimmed text of one rendered row's cells, left to right. */
  function cellsAt(index: number): string[] {
    const row = renderedRows()[index];

    return Array.from(row?.cells ?? []).map((cell) => cell.textContent?.trim() ?? '');
  }

  beforeEach(async () => {
    identifiers = vi.fn<(id: number | string) => Observable<ClientIdentifier[]>>();
    identifiersTemplate =
      vi.fn<(id: number | string) => Observable<ClientIdentifierTemplate>>();
    notificationShow = vi.fn<(kind: NotificationKind, message: string) => void>();

    // The component injects one collaborator, and both stubs stand in for the application's own
    // singletons. The cast is the one boundary where a double becomes the class it doubles, so no
    // loosely typed escape hatch appears anywhere else in this file (Rule 1 clause 4). The spec stops
    // at that token on purpose: each read's method, path, parameters and body are proven once in
    // `client.service.spec.ts`, so nothing here composes a URL or registers an HTTP provider
    // (Rule 1 clauses 5 and 8).
    const clientStub = { identifiers, identifiersTemplate } as unknown as ClientService;
    const notificationStub = {
      show: notificationShow,
      clear: vi.fn(),
      dismiss: vi.fn(),
      messages: signal<readonly NotificationMessage[]>([]),
    } as unknown as NotificationService;

    await TestBed.configureTestingModule({
      imports: [ClientIdentifiersComponent],
      providers: [
        { provide: ClientService, useValue: clientStub },
        { provide: NotificationService, useValue: notificationStub },
        provideTranslateService({ lang: 'en', fallbackLang: 'en' }),
      ],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);

    translate.setTranslation('en', EN_BUNDLE, true);
    translate.use('en');
  });

  it('renders one row per identifier, in the endpoint’s order, for a single read', async () => {
    identifiers.mockReturnValue(of([PASSPORT, NATIONAL_ID]));

    await mount(CLIENT_ID);

    // One read for the bound client, and no second one for the payload it answered with.
    expect(identifiers).toHaveBeenCalledTimes(1);
    expect(identifiers).toHaveBeenCalledWith(CLIENT_ID);
    expect(renderedRows()).toHaveLength(2);

    // Every cell carries the document's own value: the type's name, the key, the description and the
    // status, in that order, with nothing reformatted on the way (Rule 1 clause 3).
    expect(cellsAt(0)).toEqual(['Passport', 'P-99887766', 'Primary travel document', 'Active']);
    expect(cellsAt(1)).toEqual(['National ID', 'ID-12345678', 'Issued at the head office', 'Active']);
    expect(component.rows().map((row) => row.id)).toEqual([PASSPORT.id, NATIONAL_ID.id]);
    expect(component.failed()).toBe(false);
    expect(component.loading()).toBe(false);
  });

  it('renders the shared empty state, and no error, for a client with no identity document', async () => {
    identifiers.mockReturnValue(of([]));

    await mount(CLIENT_ID);

    const emptyState = host().querySelector('app-empty-state');

    // An empty payload is a successful answer: the explicit empty state renders, with the wording the
    // legacy bundle carries for the key the template hands it — never the raw dotted key.
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent?.trim()).toBe(NO_DATA_TEXT);
    expect(host().textContent ?? '').not.toContain(NO_DATA_KEY);

    // No table, no alert region and no failure state: "has no document" is not "could not read".
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(component.failed()).toBe(false);
    expect(component.rows()).toEqual([]);
    expect(identifiersTemplate).not.toHaveBeenCalled();
  });

  it('costs no document-type template read when every identifier carries its type name', async () => {
    identifiers.mockReturnValue(of([PASSPORT, NATIONAL_ID]));

    await mount(CLIENT_ID);

    // A payload that names every type needs nothing resolved, so it must not buy a second request
    // (Rule 1 clause 2: the tab calls what legacy calls, and no more).
    expect(identifiersTemplate).not.toHaveBeenCalled();
    expect(renderedRows()).toHaveLength(2);
    expect(cellsAt(0)[0]).toBe('Passport');
    expect(cellsAt(1)[0]).toBe('National ID');
  });

  it('resolves id-only document types from exactly one template read and never prints the id', async () => {
    identifiers.mockReturnValue(of([UNNAMED_PASSPORT, UNNAMED_NATIONAL_ID]));
    identifiersTemplate.mockReturnValue(of(DOCUMENT_TYPES));

    await mount(CLIENT_ID);

    // One read for the whole payload, however many documents needed a name.
    expect(identifiersTemplate).toHaveBeenCalledTimes(1);
    expect(identifiersTemplate).toHaveBeenCalledWith(CLIENT_ID);

    // The name is the template's own for the type's id: not the numeric id, and not a word this
    // component invented (Rule 1 clauses 2 and 3).
    expect(cellsAt(0)[0]).toBe('Passport');
    expect(cellsAt(1)[0]).toBe('National ID');
    expect(cellsAt(0)[0]).not.toBe(String(UNNAMED_PASSPORT.documentType.id));

    // The members the payload omitted render as empty cells, never as the text `undefined`.
    expect(cellsAt(0)).toEqual(['Passport', 'P-11223344', '', '']);
    expect(host().textContent ?? '').not.toContain('undefined');

    // A template read that rejects costs the names and nothing else: the rows still render with an
    // empty name column and the tab is not failed, because a missing label is not a missing record.
    identifiersTemplate.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_TEXT, 500)));

    await mount(CLIENT_ID);

    expect(component.failed()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(renderedRows()).toHaveLength(2);
    expect(cellsAt(0)).toEqual(['', 'P-11223344', '', '']);
    expect(component.rows().map((row) => row.documentKey)).toEqual([
      UNNAMED_PASSPORT.documentKey,
      UNNAMED_NATIONAL_ID.documentKey,
    ]);
  });

  it('offers no add, edit or delete affordance, because the tab is strictly read-only', async () => {
    identifiers.mockReturnValue(of([PASSPORT, NATIONAL_ID]));

    await mount(CLIENT_ID);

    expect(renderedRows()).toHaveLength(2);
    // The legacy tab offers no mutation of an identity document, so nothing that could carry one is
    // rendered: no control, no link and no form anywhere in the tab's DOM (Rule 1 clause 3;
    // AAP 0.10.5 item 6).
    expect(host().querySelectorAll('button, a, form, input, select, textarea')).toHaveLength(0);
  });

  it('leaves the screen usable and raises no notification when the read is rejected', async () => {
    identifiers.mockReturnValue(throwError(() => new Error('Identity read failed')));

    await mount(CLIENT_ID);

    // The screen survives the rejection: the host is still in the document, the tab records the
    // failure and paints nothing of its own for a fault the interceptor has already notified.
    expect(document.body.contains(host())).toBe(true);
    expect(component.failed()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.rows()).toEqual([]);
    expect(host().querySelector('app-empty-state')).toBeNull();
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(host().textContent?.trim()).toBe('');
    expect(notificationShow).not.toHaveBeenCalled();

    // A 4xx is the one failure the interceptor does not notify, so the tab paints Fineract's own text
    // verbatim in its alert region rather than repeating a notice (AAP 0.7.4, AAP 0.14.2).
    identifiers.mockReturnValue(throwError(() => new ApiError(SERVER_FAILURE_TEXT, 400)));

    await mount(CLIENT_ID);

    const alert = host().querySelector('[role="alert"]');

    expect(alert?.textContent?.trim()).toBe(SERVER_FAILURE_TEXT);
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('app-empty-state')).toBeNull();
    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('re-reads for a newly bound client and drops a response that arrives for the previous one', async () => {
    const firstClientRead = new Subject<ClientIdentifier[]>();
    const secondClientRead = new Subject<ClientIdentifier[]>();

    identifiers
      .mockReturnValueOnce(firstClientRead)
      .mockReturnValueOnce(secondClientRead);

    await mount(CLIENT_ID);

    expect(identifiers).toHaveBeenCalledTimes(1);

    // The record was navigated to another client, which binds the same input with that client's id.
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();
    await settle();

    expect(identifiers).toHaveBeenCalledTimes(2);
    expect(identifiers).toHaveBeenLastCalledWith(OTHER_CLIENT_ID);

    // The superseded client's response arrives late. It must not reach the tab: the load it belonged
    // to was cancelled, so nothing of the previous client can stand under the new client's record.
    firstClientRead.next([PASSPORT]);
    await settle();

    expect(component.rows()).toEqual([]);
    expect(renderedRows()).toHaveLength(0);

    secondClientRead.next([NATIONAL_ID]);
    // The read completes as a real response does, which is what ends the in-flight state the template
    // withholds the table for.
    secondClientRead.complete();
    await settle();

    expect(component.rows().map((row) => row.id)).toEqual([NATIONAL_ID.id]);
    expect(component.loading()).toBe(false);
    expect(cellsAt(0)[0]).toBe('National ID');
  });
});

