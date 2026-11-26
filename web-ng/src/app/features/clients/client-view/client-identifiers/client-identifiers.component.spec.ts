import { HttpErrorResponse } from '@angular/common/http';
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

/** Behavioural spec for the `Identities` tab of the individual client record — the read-only list of a client's identity documents. */
/** The client the tab is bound to — the `:id` of `#/viewclient/:id`, as the route delivers it. */
const CLIENT_ID = 2;
/** A second client, for the case that rebinds the input: another record must be read for. */
const OTHER_CLIENT_ID = 5;
/** The legacy bundle's wording for the key the template hands the empty state (`app/global-translations/locale-en.json`). */
const NO_DATA_KEY = 'label.nodata';
/** The same key's English wording in the shipped legacy bundle. */
const NO_DATA_TEXT = 'No Data';
/** The one key the tab's empty state resolves. */
/** The table's accessible name, from the legacy bundle's own identities heading (QA report F41). */
const IDENTITIES_HEADING_KEY = 'label.heading.identities';
/** The message that key resolves to in the in-memory bundle. */
const IDENTITIES_HEADING_TEXT = 'Identities';
/** The wording the shipped `app/global-translations/locale-en.json` bundle carries for the keys the tab resolves: the empty state's message, the table's accessible name, and the identifier-status code the Status cell passes through `TranslatePipe`, exactly as legacy's tab does (Rule 1 clauses 3 and 6). */
const EN_BUNDLE: Readonly<Record<string, string>> = {
  [NO_DATA_KEY]: NO_DATA_TEXT,
  [IDENTITIES_HEADING_KEY]: IDENTITIES_HEADING_TEXT,
  'clientIdentifierStatusType.active': 'Active',
};
/** Fineract's own text for a rejected identifier read, synthetic but shaped like the server's `defaultUserMessage`: the tab renders it character for character (Rule 1 clause 3). */
const SERVER_FAILURE_TEXT = 'The document type is not active for this client.';
/** The text a 5xx that carried no server message is rendered with — the mapper's own sentence — so the panel is provably not blank even when Fineract sends no `defaultUserMessage`. */
const SERVER_FAULT_TEXT = 'The request could not be completed.';
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
/** A document the payload sent the type id for and a blank name, without a description or a status: `ClientIdentifierTemplate` has to resolve the name. */
const UNNAMED_PASSPORT: ClientIdentifier = { id: 43, documentType: { id: 1, name: '' }, documentKey: 'P-11223344', };
/** A second document needing its name resolved, so one template read is proven to serve both. */
const UNNAMED_NATIONAL_ID: ClientIdentifier = {
  id: 44,
  documentType: { id: 2, name: '' },
  documentKey: 'ID-55667788',
  description: 'Renewed at the branch',
  status: 'Active',
};
/** The row `GET clients/{id}/identifiers` answered with for a seeded client, copied from the live response: the contract shape the populated state is proved against, `status` included as the endpoint's own code rather than as a display word (the same answer also carries a `clientId` this model does not hold and the tab never renders). */
const LIVE_IDENTIFIER: ClientIdentifier = {
  id: 2,
  documentType: { id: 2, name: 'Id' },
  documentKey: 'QA02-ID-0001',
  description: 'Second identity document',
  status: 'clientIdentifierStatusType.active',
};
/** The template's answer: the tenant's document types, in the order the endpoint returned them. */
const DOCUMENT_TYPES: ClientIdentifierTemplate = {
  allowedDocumentTypes: [{ id: 1, name: 'Passport' }, { id: 2, name: 'National ID' },],
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
  /** The fixture's host element. */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  /** Mounts the tab for one client and lets the load settle. */
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
    expect(identifiers).toHaveBeenCalledTimes(1);
    expect(identifiers).toHaveBeenCalledWith(CLIENT_ID);
    expect(renderedRows()).toHaveLength(2);
    // Every cell carries the document's own value: the type's name, the key, the description and the status, in that order, with nothing reformatted on the way (Rule 1 clause 3).
    expect(cellsAt(0)).toEqual(['Passport', 'P-99887766', 'Primary travel document', 'Active']);
    expect(cellsAt(1)).toEqual(['National ID', 'ID-12345678', 'Issued at the head office', 'Active']);
    expect(component.rows().map((row) => row.id)).toEqual([PASSPORT.id, NATIONAL_ID.id]);
    expect(component.failed()).toBe(false);
    expect(component.loading()).toBe(false);
  });
  it('names the table with the identities heading through a visually hidden caption', async () => {
    identifiers.mockReturnValue(of([PASSPORT, NATIONAL_ID]));
    await mount(CLIENT_ID);

    const table = host().querySelector('table');
    const caption = table?.querySelector('caption');

    // The caption is the table's own naming element and Bootstrap's `.sr-only` keeps it off the screen, so the
    // tab's table is announced by the legacy bundle's identities heading without a pixel moving (QA report F41).
    expect(caption?.textContent?.trim()).toBe(IDENTITIES_HEADING_TEXT);
    expect(caption?.classList.contains('sr-only')).toBe(true);
    expect(table?.firstElementChild).toBe(caption);
  });

  it('renders the populated state a live read answers with, cell for cell', async () => {
    identifiers.mockReturnValue(of([LIVE_IDENTIFIER]));
    await mount(CLIENT_ID);
    // The one document the endpoint answers with renders as exactly one row: nothing duplicated, dropped or reordered (Rule 1 clause 3).
    expect(renderedRows()).toHaveLength(1);
    expect(identifiersTemplate).not.toHaveBeenCalled();
    // All four cells carry the payload's own values — the type's name, the document key, the description and the status — with the status resolved through the legacy bundle the way legacy's tab resolves it, so the code the endpoint sends prints as its word rather than raw (Rule 1 clauses 3 and 6).
    expect(cellsAt(0)).toEqual([
      'Id',
      'QA02-ID-0001',
      'Second identity document',
      'Active',
    ]);
    expect(component.rows()).toEqual([
      {
        id: LIVE_IDENTIFIER.id,
        documentTypeName: 'Id',
        documentKey: 'QA02-ID-0001',
        description: 'Second identity document',
        status: 'clientIdentifierStatusType.active',
      },
    ]);
    expect(component.failed()).toBe(false);
  });

  it('marks its one content element busy while the read is in flight, and adds nothing to it', async () => {
    const pending = new Subject<ClientIdentifier[]>();
    identifiers.mockReturnValue(pending);
    await mount(CLIENT_ID);

    // One wrapper element, and it carries the in-flight marker and nothing else: no class, no style, no second element (AAP 0.7.4 state rules).
    const region = host().firstElementChild as HTMLElement | null;
    expect(host().childElementCount).toBe(1);
    expect(component.loading()).toBe(true);
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.className).toBe('');
    expect(region?.hasAttribute('style')).toBe(false);

    pending.next([PASSPORT]);
    pending.complete();
    await settle();

    expect(region?.getAttribute('aria-busy')).toBeNull();
    expect(renderedRows()).toHaveLength(1);
  });
  it('renders the shared empty state, and no error, for a client with no identity document', async () => {
    identifiers.mockReturnValue(of([]));
    await mount(CLIENT_ID);
    const emptyState = host().querySelector('app-empty-state');
    // An empty payload is a successful answer: the explicit empty state renders, with the wording the legacy bundle carries for the key the template hands it — never the raw dotted key.
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent?.trim()).toBe(NO_DATA_TEXT);
    expect(host().textContent ?? '').not.toContain(NO_DATA_KEY);
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('[role="alert"]')).toBeNull();
    expect(component.failed()).toBe(false);
    expect(component.rows()).toEqual([]);
    expect(identifiersTemplate).not.toHaveBeenCalled();
  });
  it('costs no document-type template read when every identifier carries its type name', async () => {
    identifiers.mockReturnValue(of([PASSPORT, NATIONAL_ID]));
    await mount(CLIENT_ID);
    // A payload that names every type needs nothing resolved, so it must not buy a second request (Rule 1 clause 2: the tab calls what legacy calls, and no more).
    expect(identifiersTemplate).not.toHaveBeenCalled();
    expect(renderedRows()).toHaveLength(2);
    expect(cellsAt(0)[0]).toBe('Passport');
    expect(cellsAt(1)[0]).toBe('National ID');
  });
  it('resolves id-only document types from exactly one template read and never prints the id', async () => {
    identifiers.mockReturnValue(of([UNNAMED_PASSPORT, UNNAMED_NATIONAL_ID]));
    identifiersTemplate.mockReturnValue(of(DOCUMENT_TYPES));
    await mount(CLIENT_ID);
    expect(identifiersTemplate).toHaveBeenCalledTimes(1);
    expect(identifiersTemplate).toHaveBeenCalledWith(CLIENT_ID);
    // The name is the template's own for the type's id: not the numeric id, and not a word this component invented (Rule 1 clauses 2 and 3).
    expect(cellsAt(0)[0]).toBe('Passport');
    expect(cellsAt(1)[0]).toBe('National ID');
    expect(cellsAt(0)[0]).not.toBe(String(UNNAMED_PASSPORT.documentType.id));
    // The members the payload omitted render as empty cells, never as the text `undefined`.
    expect(cellsAt(0)).toEqual(['Passport', 'P-11223344', '', '']);
    expect(host().textContent ?? '').not.toContain('undefined');
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
    // The legacy tab offers no mutation of an identity document, so nothing that could carry one is rendered: no control, no link and no form anywhere in the tab's DOM (Rule 1 clause 3; AAP 0.10.5 item 6).
    expect(host().querySelectorAll('button, a, form, input, select, textarea')).toHaveLength(0);
  });
  it('leaves the screen usable and raises no notification when the read is rejected', async () => {
    identifiers.mockReturnValue(throwError(() => new Error('Identity read failed')));
    await mount(CLIENT_ID);
    expect(document.body.contains(host())).toBe(true);
    expect(component.failed()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.rows()).toEqual([]);
    expect(host().querySelector('app-empty-state')).toBeNull();
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Identity read failed');
    expect(component.errorMessage()).toBe('Identity read failed');
    expect(notificationShow).not.toHaveBeenCalled();
    // A 5xx is the failure the interceptor notifies: the panel carries that failure's own text in its alert, so a refused read never paints blank, while the tab raises no notification of its own (AAP 0.7.4; AAP 0.14.2).
    identifiers.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await mount(CLIENT_ID);
    expect(host().querySelector('[role="alert"]')?.textContent?.trim()).toBe(SERVER_FAULT_TEXT);
    expect(component.errorMessage()).toBe(SERVER_FAULT_TEXT);
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('app-empty-state')).toBeNull();
    expect(notificationShow).not.toHaveBeenCalled();
    // A 4xx is the one failure the interceptor does not notify, so the tab paints Fineract's own text verbatim in its alert region rather than repeating a notice (AAP 0.7.4, AAP 0.14.2).
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
    identifiers.mockReturnValueOnce(firstClientRead).mockReturnValueOnce(secondClientRead);
    await mount(CLIENT_ID);
    expect(identifiers).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();
    await settle();
    expect(identifiers).toHaveBeenCalledTimes(2);
    expect(identifiers).toHaveBeenLastCalledWith(OTHER_CLIENT_ID);
    firstClientRead.next([PASSPORT]);
    await settle();
    expect(component.rows()).toEqual([]);
    expect(renderedRows()).toHaveLength(0);
    secondClientRead.next([NATIONAL_ID]);
    secondClientRead.complete();
    await settle();
    expect(component.rows().map((row) => row.id)).toEqual([NATIONAL_ID.id]);
    expect(component.loading()).toBe(false);
    expect(cellsAt(0)[0]).toBe('National ID');
  });
});
