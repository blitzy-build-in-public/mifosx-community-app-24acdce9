/**
 * Behaviour of the global search results screen: the destination of the signed-in navbar's search
 * control (AAP 0.7.1 Features row `search`; AAP 0.7.3 row "Shell: global search"; AAP 0.8.2 route
 * `search/:query`; AAP 0.7.4 states; AAP 0.11.1 row for this folder).
 *
 * It discharges AAP 0.11.1 (a unit spec beside every component), AAP 0.14.1 ("each screen lands with
 * at least one behavioural spec") and Rule 1 clause 8 (no spec without an `expect`, nothing
 * boilerplate). What it proves is the contract the screen advertises: exactly one search per
 * parameter set with exactly the two parameters the service takes, a trimmed query that is never sent
 * empty, a scope validated against the three the control offers, one row per result carrying the
 * server's own values, the client and loan records the rows open, the explicit empty state, a failure
 * rendered verbatim with the previous rows kept, a parameter change that replaces the results, and a
 * loan row listed but not linked to a user without the loan read permission.
 *
 * Providers, and what each one proves. `provideRouter([])` because the rows link through `RouterLink`
 * and the component builds their destinations with `Router`; an empty route table is enough, because
 * the assertions read the hrefs the router serialises rather than where a click would land. The
 * translate stack because every label resolves through `TranslatePipe`, and `provideTranslateService()`
 * is the library's own registration of `TranslateService` (declared without `providedIn` in
 * ngx-translate 18.1.0, so the pipe's non-optional injection would fail without it); its omitted
 * loader slot defaults to the no-op loader, so no bundle is requested. The `ActivatedRoute` stand-in
 * hands the component the two observables it reads, which is what lets a test push a second parameter
 * set the way the navbar does. `SearchService` is replaced by a recorder, so the assertions are about
 * the request this screen makes rather than about a request the real service would build. No HTTP
 * provider is installed at all: the component reaches Fineract through the service alone, and any
 * attempt to do otherwise would fail with NG0201 instead of passing silently (Rule 1 clause 5).
 *
 * The fixtures are shaped like the answers the running fork produces: a client row naming the client,
 * a loan row whose `entityName` is the loan product's name with the owning client in `parentName`,
 * and a client matched by one of its identifiers. They are test input only and reproduce no shipped
 * data (Rule 1 clauses 6 and 9).
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  MissingTranslationHandler,
  TranslateService,
  provideTranslateService,
} from '@ngx-translate/core';
import { BehaviorSubject, type Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GlobalSearchParams, SearchResult } from '../../core/api/search.service';
import { SearchService } from '../../core/api/search.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { FineractMissingTranslationHandler } from '../../core/i18n/missing-translation.handler';
import { ApiError } from '../../core/http/api-error';
import { SearchResultsComponent } from './search-results.component';

const CLIENT: SearchResult = {
  entityType: 'CLIENT',
  entityId: 2,
  entityName: 'Ada Okafor',
  entityAccountNo: '000000002',
  parentId: 1,
  parentName: 'Head Office',
  entityStatus: { id: 300, code: 'clientStatusType.active', value: 'Active' },
};

const LOAN: SearchResult = {
  entityType: 'LOAN',
  entityId: 11,
  entityName: 'Parity Loan',
  entityAccountNo: '000000011',
  parentId: 2,
  parentName: 'Ada Okafor',
  entityStatus: { id: 300, code: 'loanStatusType.active', value: 'Active' },
};

const IDENTIFIER: SearchResult = {
  entityType: 'CLIENTIDENTIFIER',
  entityId: 7,
  entityName: 'ID-99887766',
  parentId: 2,
  parentName: 'Ada Okafor',
  entityStatus: { id: 100, code: 'clientStatusType.pending', value: 'Pending' },
};

const NO_DATA_TEXT = 'Nothing matched from the spec bundle';
const LABELS = {
  'label.nodatafound': NO_DATA_TEXT,
  'label.heading.name': 'Name',
  'label.heading.accnum': 'Account No',
  'label.heading.clientname': 'Client Name',
  'label.heading.type': 'Type',
  'label.heading.client': 'Client',
  'label.heading.loan': 'Loan',
  'label.heading.status': 'Status',
};

describe('SearchResultsComponent', () => {
  let fixture: ComponentFixture<SearchResultsComponent>;
  let component: SearchResultsComponent;
  let calls: GlobalSearchParams[];
  let answer: () => Observable<SearchResult[]>;
  const params = new BehaviorSubject(convertToParamMap({ query: 'Parity' }));
  const queryParams = new BehaviorSubject(convertToParamMap({ scope: 'all' }));

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const rows = (): HTMLTableRowElement[] =>
    Array.from(host().querySelectorAll<HTMLTableRowElement>('#search-results tbody tr'));

  const anchors = (): HTMLAnchorElement[] =>
    Array.from(host().querySelectorAll<HTMLAnchorElement>('#search-results a'));

  beforeEach(async () => {
    calls = [];
    answer = () => of([CLIENT, LOAN]);
    params.next(convertToParamMap({ query: 'Parity' }));
    queryParams.next(convertToParamMap({ scope: 'all' }));

    await TestBed.configureTestingModule({
      imports: [SearchResultsComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          missingTranslationHandler: {
            provide: MissingTranslationHandler,
            useClass: FineractMissingTranslationHandler,
          },
        }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            queryParamMap: queryParams.asObservable(),
          },
        },
        {
          provide: SearchService,
          useValue: {
            search: (searchParams: GlobalSearchParams): Observable<SearchResult[]> => {
              calls.push(searchParams);
              return answer();
            },
          },
        },
      ],
    }).compileComponents();

    TestBed.inject(TranslateService).setTranslation('en', LABELS);
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT', 'READ_LOAN']);

    fixture = TestBed.createComponent(SearchResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('issues exactly one search for the initial navigation, with exactly two parameters', () => {
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ query: 'Parity', resource: 'all' });
    expect(Object.keys(calls[0]).sort()).toEqual(['query', 'resource']);
    expect(component.query()).toBe('Parity');
    expect(component.scope()).toBe('all');
  });

  it('trims the query, and an empty or blank one is never sent', async () => {
    params.next(convertToParamMap({ query: '   ' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toHaveLength(1);
    expect(component.query()).toBe('');
    expect(component.isEmpty()).toBe(true);
    expect(host().querySelector('#search-results')).toBeNull();
    expect(host().querySelector('#search-results-empty')?.textContent?.trim()).toBe(NO_DATA_TEXT);
    expect(host().querySelector('#search-results-error')).toBeNull();
  });

  it('accepts only the three scopes and answers anything else with all', async () => {
    queryParams.next(convertToParamMap({ scope: 'groups' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.resource).toBe('all');

    queryParams.next(convertToParamMap({ scope: 'clients' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.resource).toBe('clients');
    expect(calls).toHaveLength(3);
  });

  it('renders one row per result, with the server values the table binds', () => {
    const rendered = rows();

    expect(rendered).toHaveLength(2);
    expect(component.rows()).toHaveLength(2);
    expect(component.rows()[0]).toMatchObject({
      kind: 'client',
      name: 'Ada Okafor',
      accountNo: '000000002',
      clientName: '',
      status: 'active',
      permission: 'READ_CLIENT',
    });
    expect(component.rows()[1]).toMatchObject({
      kind: 'loan',
      name: 'Parity Loan',
      accountNo: '000000011',
      clientName: 'Ada Okafor',
      product: 'Parity Loan',
      status: 'active',
      permission: 'READ_LOAN',
    });
    expect(rendered[0]?.cells[0]?.textContent?.trim()).toBe('Client');
    expect(rendered[1]?.cells[0]?.textContent?.trim()).toBe('Loan');
    expect(rendered[1]?.textContent).toContain('Ada Okafor');
    expect(rendered[0]?.querySelector('app-status-swatch')).not.toBeNull();
    expect(rendered[1]?.querySelector('app-status-swatch .status-swatch')).not.toBeNull();
  });

  it('maps each family status code onto the four keys the indicator paints', async () => {
    const withStatus = (code: string, id: number): SearchResult => ({
      entityType: 'LOAN',
      entityId: id,
      entityName: 'Parity Loan',
      entityAccountNo: `00000001${id}`,
      parentName: 'Ada Okafor',
      entityStatus: { id: 1, code, value: 'whatever the server calls it' },
    });

    answer = () =>
      of([
        withStatus('loanStatusType.submitted.and.pending.approval', 1),
        withStatus('loanStatusType.closed.obligations.met', 2),
        withStatus('clientStatusType.withdraw', 3),
        withStatus('loanStatusType.transfer.in.progress', 4),
        withStatus('clientStatusType.active', 5),
      ]);

    params.next(convertToParamMap({ query: 'Parity' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.rows().map((row) => row.status)).toEqual([
      'pending',
      'closed',
      'closed',
      'other',
      'active',
    ]);
    // Every row's key is its own, so two results can never collide in the loop's track expression.
    expect(new Set(component.rows().map((row) => row.key)).size).toBe(5);
  });

  it('opens the client record and the loan record, and maps an identifier to its client', async () => {
    expect(anchors().map((anchor) => anchor.getAttribute('href'))).toEqual([
      '/viewclient/2',
      '/viewloanaccount/11',
    ]);

    answer = () => of([IDENTIFIER]);
    params.next(convertToParamMap({ query: 'ID-9988' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0]?.key).toBe('clientIdentifier:7');
    expect(component.rows()[0]?.status).toBe('pending');
    expect(anchors()[0]?.getAttribute('href')).toBe('/viewclient/2');
  });

  it('renders the explicit empty state and no error when a completed search matched nothing', () => {
    expect(host().querySelector('#search-results-empty')).toBeNull();

    answer = () => of([]);
    params.next(convertToParamMap({ query: 'Nothing' }));

    fixture.detectChanges();

    expect(component.isEmpty()).toBe(true);
    expect(component.error()).toBeNull();
    expect(host().querySelector('#search-results-empty')?.textContent?.trim()).toBe(NO_DATA_TEXT);
    expect(host().querySelector('#search-results-error')).toBeNull();
  });

  it("shows Fineract's message verbatim, keeps the previous rows and never turns a failure into an empty result", async () => {
    const serverText = 'The loan principal is outside the permitted range.';

    answer = () => throwError(() => new ApiError(serverText, 400));
    params.next(convertToParamMap({ query: 'Parity' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.error()).toBe(serverText);
    expect(host().querySelector('#search-results-error')?.textContent?.trim()).toBe(serverText);
    expect(component.isEmpty()).toBe(false);
    expect(host().querySelector('#search-results-empty')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('replaces the results with exactly one new request when the parameters change', async () => {
    expect(calls).toHaveLength(1);

    answer = () => of([CLIENT]);
    params.next(convertToParamMap({ query: 'Ada' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toHaveLength(2);
    expect(component.query()).toBe('Ada');
    expect(rows()).toHaveLength(1);
    expect(component.error()).toBeNull();
  });

  it('lists a loan row to a user without READ_LOAN but does not offer the link', async () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT']);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const loanRow = rows()[1];
    const anchor = loanRow?.querySelector('a');
    const plain = loanRow?.querySelector('span');

    expect(anchor?.style.display).toBe('none');
    expect(plain?.style.display).not.toBe('none');
    expect(plain?.textContent?.trim()).toBe('Parity Loan');
    expect(rows()[0]?.querySelector('a')?.style.display).not.toBe('none');
  });

  it('survives a failure and searches again afterwards', async () => {
    answer = () => throwError(() => new ApiError('Server is unavailable', 500));
    params.next(convertToParamMap({ query: 'first' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.error()).toBe('Server is unavailable');

    answer = () => of([CLIENT]);
    params.next(convertToParamMap({ query: 'second' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });
});
