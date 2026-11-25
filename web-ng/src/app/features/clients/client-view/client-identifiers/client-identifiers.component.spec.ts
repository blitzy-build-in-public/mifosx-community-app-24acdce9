import {
  provideHttpClient,
  withInterceptors,
  type HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { catchError, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../../../core/config/app-config.model';
import { AppConfigService } from '../../../../core/config/app-config.service';
import { toApiError } from '../../../../core/http/api-error';
import type {
  ClientIdentifier,
  ClientIdentifierTemplate,
} from '../../client.models';
import { ClientIdentifiersComponent } from './client-identifiers.component';

/**
 * Behaviour of the `Identities` tab of the individual client record — the read-only list of the
 * client's identity documents, loaded by this component from the two reads AAP 0.7.3 row "W3 search
 * and view client" assigns it (AAP 0.7.1 Features row `clients`, `ClientViewComponent` with
 * `ClientIdentifiersComponent`; AAP 0.7.4 `#/viewclient/:id`, Figma node `1:4`; AAP 0.11.1 "unit
 * specs beside every component and service"; Rule 1 clause 8).
 *
 * What it pins is this section's own loading contract, which is the part a rewrite would silently
 * change:
 *
 *  1. exactly one `GET /clients/{id}/identifiers`, and no document-type template read at all when
 *     every identifier arrived with its type's name — a payload that needs no resolution must not
 *     cost a second request (Rule 1 clause 2: the app calls what legacy calls, and no more);
 *  2. an identifier that arrived with only its document-type id costs exactly one
 *     `GET /clients/{id}/identifiers/template`, and the name the row shows is the template's own for
 *     that id, never the numeric id and never a name this component invented;
 *  3. a rejected template read degrades to an empty name while the rows still render and the tab is
 *     not failed, because a missing label is not a missing record;
 *  4. a rejected identifiers read flags the failure and leaves no rows, so the tab never claims the
 *     client has no documents when they could not be read;
 *  5. an empty array renders the shared explicit empty state and no table (AAP 0.7.4);
 *  6. a payload that omits `description` and `status` renders empty cells — never the text
 *     `undefined` and never a placeholder (Rule 1 clause 3);
 *  7. rebinding the `clientId` input re-reads for the new client and replaces the rows, so a record
 *     navigated to another client cannot show the previous one's documents.
 *
 * **What is deliberately not asserted.** The column headings are not checked here, because their
 * translation is a separate finding's change; and the tab renders no failure text of its own by
 * design, so nothing about a 4xx message surface is asserted either — the interceptor's notification
 * carries it.
 *
 * **Providers.** The configuration is loaded from a stubbed `fetch` before the component exists,
 * because the service composes both URLs from it. The ngx-translate stack is registered for the
 * template's pipe. There is no router and no second service: this tab's only collaborator is the
 * clients family's own service, and the error mapping is the production one installed as an
 * interceptor, so a failure arrives as the `ApiError` the component catches in the application
 * (AAP 0.4.2; Rule 1 clause 5).
 *
 * The fixtures are synthetic: invented document keys and descriptions. Nothing here reproduces
 * tenant data, and nothing logs a client id, a document key or a description (Rule 1 clause 9;
 * the PII rule the plan states for this tab).
 */

/** The configuration the stubbed transport serves: the application's own documented default shape. */
const SERVED_CONFIG = DEFAULT_APP_CONFIG;

/** The API root every client URL is composed from, built from the resolved configuration. */
const API_ROOT = `${SERVED_CONFIG.apiBaseUrl}${SERVED_CONFIG.apiPath}`;

/** The client whose identity documents the tab is bound to, as the record route delivers it. */
const CLIENT_ID = '2';

/** A second client, for the rebinding case: a record opened on another client must re-read. */
const OTHER_CLIENT_ID = 5;

/**
 * `GET /clients/{id}/identifiers` for one client id, composed from the same root the service uses, so
 * a changed endpoint fails this suite rather than passing silently (Rule 1 clause 2).
 *
 * @param id the client id the URL names.
 */
function identifiersUrl(id: number | string): string {
  return `${API_ROOT}/clients/${id}/identifiers`;
}

/**
 * `GET /clients/{id}/identifiers/template` — the read that resolves a document-type name the payload
 * left out.
 *
 * @param id the client id the URL names.
 */
function templateUrl(id: number | string): string {
  return `${API_ROOT}/clients/${id}/identifiers/template`;
}

/** A document whose payload already carries its type's name: no resolution is needed for it. */
const PASSPORT: ClientIdentifier = {
  id: 41,
  documentType: { id: 1, name: 'Passport' },
  documentKey: 'P-99887766',
  description: 'Primary travel document',
  status: 'Active',
};

/** A second named document, so a case can prove the order and the count of rows. */
const NATIONAL_ID: ClientIdentifier = {
  id: 42,
  documentType: { id: 2, name: 'National ID' },
  documentKey: 'ID-12345678',
  description: 'Issued at the head office',
  status: 'Active',
};

/**
 * A document whose payload carried only its document type's id: the model types `name` as a string,
 * so the absent name arrives as an empty one, which is exactly the state the conditional template
 * read exists to resolve.
 */
const UNNAMED_TYPE: ClientIdentifier = {
  id: 43,
  documentType: { id: 1, name: '' },
  documentKey: 'P-11223344',
  description: '',
  status: 'Active',
};

/**
 * A document the payload sent no description and no status for: both members are optional on the
 * wire, and both must render as empty cells rather than as `undefined`.
 */
const BARE_IDENTIFIER: ClientIdentifier = {
  id: 44,
  documentType: { id: 2, name: 'National ID' },
  documentKey: 'ID-55667788',
};

/** The template's answer: the tenant's document types, in the server's order. */
const DOCUMENT_TYPES: ClientIdentifierTemplate = {
  allowedDocumentTypes: [
    { id: 1, name: 'Passport' },
    { id: 2, name: 'National ID' },
  ],
};

/**
 * Installs the production mapping of a Fineract failure onto the test transport, so a rejection
 * arrives as the `ApiError` the component catches (AAP 0.4.2).
 */
const MAP_FINERACT_FAILURES: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((failure: HttpErrorResponse) => throwError(() => toApiError(failure))),
  );

describe('ClientIdentifiersComponent', () => {
  let fixture: ComponentFixture<ClientIdentifiersComponent>;
  let component: ClientIdentifiersComponent;
  let httpMock: HttpTestingController;

  // `ComponentFixture.nativeElement` is typed `any` by Angular; narrowing it once here confines the
  // cast to one line and keeps the DOM assertions type-checked (Rule 1 clause 4).
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Mounts the tab for one client.
   *
   * The input is bound before the first change detection because the component loads from it as soon
   * as it is set: the effect that hands the id to the load pipeline runs in that first pass, so the
   * read a case answers is already in flight when this returns.
   */
  function mount(clientId: number | string): void {
    fixture = TestBed.createComponent(ClientIdentifiersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('clientId', clientId);
    fixture.detectChanges();
  }

  /** Matches the tab's read for `clientId`. */
  function isIdentifiersRead(
    clientId: number | string,
  ): (request: TestRequest['request']) => boolean {
    return (request) => request.method === 'GET' && request.url === identifiersUrl(clientId);
  }

  /** Matches the document-type template read for `clientId`. */
  function isTemplateRead(clientId: number | string): (request: TestRequest['request']) => boolean {
    return (request) => request.method === 'GET' && request.url === templateUrl(clientId);
  }

  /** The rendered document rows, in document order. */
  function renderedRows(): HTMLTableRowElement[] {
    return Array.from(host().querySelectorAll<HTMLTableRowElement>('tbody tr'));
  }

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => {
        // `Response` stand-in: the three members `AppConfigService.fetchRawConfig` reads. The cast is
        // the single boundary where the partial object becomes the response the service expects.
        const body = {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve(SERVED_CONFIG),
        };

        return Promise.resolve(body as unknown as Response);
      }),
    );

    TestBed.configureTestingModule({
      imports: [ClientIdentifiersComponent],
      providers: [
        provideHttpClient(withInterceptors([MAP_FINERACT_FAILURES])),
        provideHttpClientTesting(),
        provideTranslateService(),
      ],
    });

    await TestBed.inject(AppConfigService).load();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {}, true);
    translate.use('en');

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('reads the bound client’s identifiers once and needs no template when every name arrived', async () => {
    mount(CLIENT_ID);

    const read = httpMock.expectOne(isIdentifiersRead(CLIENT_ID));

    expect(read.request.method).toBe('GET');
    // The endpoint takes the client id in its path alone, and the array it answers with is read
    // directly rather than through an envelope.
    expect(read.request.params.keys()).toEqual([]);
    expect(read.request.body).toBeNull();
    expect(httpMock.match(() => true)).toHaveLength(0);

    read.flush([PASSPORT, NATIONAL_ID]);
    await fixture.whenStable();
    fixture.detectChanges();

    // A payload that names every type costs no second request at all (Rule 1 clause 2).
    expect(httpMock.match(isTemplateRead(CLIENT_ID))).toHaveLength(0);
    expect(component.rows()).toHaveLength(2);
    expect(component.rows().map((row) => row.id)).toEqual([41, 42]);
    expect(component.rows().map((row) => row.documentTypeName)).toEqual(['Passport', 'National ID']);
    expect(component.rows().map((row) => row.documentKey)).toEqual([
      PASSPORT.documentKey,
      NATIONAL_ID.documentKey,
    ]);
    expect(component.failed()).toBe(false);
    expect(renderedRows()).toHaveLength(2);
  });

  it('resolves a missing document-type name from exactly one template read', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isIdentifiersRead(CLIENT_ID)).flush([UNNAMED_TYPE]);
    await fixture.whenStable();

    const template = httpMock.expectOne(isTemplateRead(CLIENT_ID));

    expect(template.request.method).toBe('GET');
    expect(template.request.params.keys()).toEqual([]);

    template.flush(DOCUMENT_TYPES);
    await fixture.whenStable();
    fixture.detectChanges();

    // The name is the template's own for the type's id: not the numeric id, and not a word this
    // component invented (Rule 1 clauses 2 and 3).
    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0]?.documentTypeName).toBe('Passport');
    expect(component.rows()[0]?.documentTypeName).not.toBe('1');
    expect(renderedRows()[0]?.cells[0]?.textContent?.trim()).toBe('Passport');
    // One read per load, however many identifiers needed a name.
    expect(httpMock.match(isTemplateRead(CLIENT_ID))).toHaveLength(0);
    expect(httpMock.match(() => true)).toHaveLength(0);
  });

  it('renders the rows with an empty name when the template read is rejected', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isIdentifiersRead(CLIENT_ID)).flush([UNNAMED_TYPE]);
    await fixture.whenStable();

    httpMock
      .expectOne(isTemplateRead(CLIENT_ID))
      .flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    // A missing label is not a missing record: the row renders with its other columns and the tab is
    // not failed (Rule 1 clause 3 — the tab is not failed for a name).
    expect(component.failed()).toBe(false);
    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0]?.documentTypeName).toBe('');
    expect(component.rows()[0]?.documentKey).toBe(UNNAMED_TYPE.documentKey);
    expect(renderedRows()).toHaveLength(1);
    expect(renderedRows()[0]?.cells[0]?.textContent?.trim()).toBe('');
    expect(httpMock.match(() => true)).toHaveLength(0);
  });

  it('flags a rejected identifiers read and leaves no rows behind', async () => {
    mount(CLIENT_ID);
    httpMock
      .expectOne(isIdentifiersRead(CLIENT_ID))
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
    expect(component.rows()).toEqual([]);
    expect(component.loading()).toBe(false);
    // No row survives a failed load, so the tab never claims the client has no documents when they
    // could not be read (AAP 0.7.4).
    expect(renderedRows()).toHaveLength(0);
    // No template read is attempted for a payload that never arrived.
    expect(httpMock.match(isTemplateRead(CLIENT_ID))).toHaveLength(0);
  });

  it('renders the shared explicit empty state for a client with no identity document', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isIdentifiersRead(CLIENT_ID)).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows()).toEqual([]);
    expect(component.failed()).toBe(false);
    expect(host().querySelector('app-empty-state')).not.toBeNull();
    expect(host().querySelector('table')).toBeNull();
    expect(httpMock.match(isTemplateRead(CLIENT_ID))).toHaveLength(0);
  });

  it('renders empty cells for a payload that omits the description and the status', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isIdentifiersRead(CLIENT_ID)).flush([BARE_IDENTIFIER]);
    await fixture.whenStable();
    fixture.detectChanges();

    // An absent member becomes the empty string rather than the text `undefined` (Rule 1 clause 3).
    expect(component.rows()[0]?.description).toBe('');
    expect(component.rows()[0]?.status).toBe('');

    const cells = Array.from(renderedRows()[0]?.cells ?? []).map(
      (cell) => cell.textContent?.trim() ?? '',
    );

    expect(cells).toEqual(['National ID', BARE_IDENTIFIER.documentKey, '', '']);
    expect(host().textContent ?? '').not.toContain('undefined');
  });

  it('re-reads for a newly bound client and replaces the rows', async () => {
    mount(CLIENT_ID);
    httpMock.expectOne(isIdentifiersRead(CLIENT_ID)).flush([PASSPORT, NATIONAL_ID]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows()).toHaveLength(2);

    // The record was navigated to another client, which binds the same input with that client's id.
    fixture.componentRef.setInput('clientId', OTHER_CLIENT_ID);
    fixture.detectChanges();

    const reRead = httpMock.expectOne(isIdentifiersRead(OTHER_CLIENT_ID));

    expect(reRead.request.method).toBe('GET');
    expect(component.loading()).toBe(true);

    reRead.flush([BARE_IDENTIFIER]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows().map((row) => row.id)).toEqual([BARE_IDENTIFIER.id]);
    expect(component.loading()).toBe(false);
    expect(httpMock.match(() => true)).toHaveLength(0);
  });
});
