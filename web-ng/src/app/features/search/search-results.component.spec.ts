/** Behaviour of the global search results screen: the destination of the signed-in navbar's search control (AAP 0.7.1 Features row `search`; AAP 0.7.3 row "Shell: global search"; AAP 0.8.2 route `search/:query`; AAP 0.7.4 states; AAP 0.11.1, AAP 0.14.1, Rule 1 clause 8, Rule 1 clause 5). */

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

/** The name of a row `GET /search` sends for an entity family this control never asks for — a savings account or a group, which AAP 0.10.5 item 9 keeps outside the client, client-identifier and loan scopes the search offers — so its `entityType` is outside the three the model narrows to. That `entityType` is a plain string on the wire, so the row is typed `unknown` here and enters the answer through the cast below, which is the documented boundary of Rule 1 clause 4. */
const UNMAPPED_ROW_NAME = 'Blitzy Savings Account';
const UNMAPPED_ROW: unknown = {
  entityType: 'SAVINGSACCOUNT', entityId: 15, entityName: UNMAPPED_ROW_NAME, entityAccountNo: '000000015',
  parentId: 2, parentName: 'Ada Okafor',
};

const NO_DATA_TEXT = 'Nothing matched from the spec bundle';

/** The legacy bundle's own truncation message, `label.search.query.matched.results.exceeds.max.length` (`app/global-translations/locale-en.json:678`), served here so the case below asserts that the screen renders that key. */
const TRUNCATED_TEXT = 'This query shows only the first 200 records.';

/** A search answer carrying `count` client results, each named by its ordinal so a case can see which results survived legacy's cut: an answer of more than 200 is rendered as its first 201. @param count how many results. */
function clientResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, index): SearchResult => {
    const ordinal: string = `${index + 1}`;

    return {
      entityType: 'CLIENT',
      entityId: index + 1,
      entityName: `Client ${ordinal}`,
      entityAccountNo: ordinal.padStart(9, '0'),
      parentName: 'Head Office',
    };
  });
}

/** The rejections that carry no text for this screen, each for a reason the screen must honour: a 5xx and a transport failure (status `0`) have already raised the interceptor's single notification, and a rejection that is not an `ApiError` never came from Fineract at all — its message is Angular's or the application's own text, which can embed the request URL (AAP 0.7.4). The fourth row is a rejection that is not even an `Error`, which carries nothing to show by definition. */
const SILENT_FAILURES: readonly { readonly label: string; readonly failure: () => unknown }[] = [
  {
    label: 'a 5xx',
    failure: () => new ApiError('Server is unavailable', 500),
  },
  {
    label: 'a transport failure',
    failure: () => new ApiError('The API could not be reached', 0),
  },
  {
    label: 'a rejection that is not an ApiError',
    failure: () => new Error('A fault the screen itself raised'),
  },
  {
    label: 'a rejection that is not an Error',
    failure: () => 'nothing an Error carries',
  },
];
/** Only the keys the rendered markup resolves: the screen's own title, the empty state's message, the entity and parent labels of the blocks' second line, and legacy's truncation notice. */
const LABELS = {
  'label.heading.search': 'Search',
  'label.nodatafound': NO_DATA_TEXT,
  'label.heading.entity': 'Entity',
  'label.heading.client': 'Client',
  'label.heading.loan': 'Loan',
  'label.heading.office': 'Office',
  'label.search.query.matched.results.exceeds.max.length': TRUNCATED_TEXT,
};

describe('SearchResultsComponent', () => {
  let fixture: ComponentFixture<SearchResultsComponent>;
  let component: SearchResultsComponent;
  let calls: GlobalSearchParams[];
  let answer: () => Observable<SearchResult[]>;
  const params = new BehaviorSubject(convertToParamMap({ query: 'Parity' }));
  const queryParams = new BehaviorSubject(convertToParamMap({ scope: 'all' }));

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The rendered results: legacy's own blocks, one per result, inside the container that marks the answer (`app/views/search/glresults.html:9-66`). */
  const blocks = (): HTMLDivElement[] =>
    Array.from(host().querySelectorAll<HTMLDivElement>('#search-results .blockquoteresult'));

  /** A block's rendered text with every run of whitespace — the `&nbsp;` entities among the separators included — collapsed to one space, so a case can name what a reader sees without depending on the markup's own line. */
  const text = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/[\s\u00A0]+/g, ' ').trim();

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

  it('issues exactly one search for the initial navigation, with exactly three parameters', () => {
    expect(calls).toHaveLength(1);
    // The three parameters legacy's controller forwards, the flag included: an absent `exactMatch` in the URL is legacy's unquoted `false`, so it is sent rather than dropped.
    expect(calls[0]).toEqual({ query: 'Parity', resource: 'all', exactMatch: false });
    expect(Object.keys(calls[0]).sort()).toEqual(['exactMatch', 'query', 'resource']);
    expect(component.query()).toBe('Parity');
    expect(component.scope()).toBe('all');
  });

  it("sends the exact-match flag the URL carries, and legacy's default when it carries none", async () => {
    queryParams.next(convertToParamMap({ scope: 'all', exactMatch: 'true' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.exactMatch).toBe(true);

    queryParams.next(convertToParamMap({ scope: 'all' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.exactMatch).toBe(false);
    expect(calls).toHaveLength(3);
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
    expect(host().querySelector('#search-results-truncated')).toBeNull();
  });

  it('accepts only the three scopes and answers anything else with all', async () => {
    // Every value outside the control's three: the legacy scopes this migration leaves to the legacy application (groups, savings, shares), a differently cased spelling and an empty one (AAP 0.10.5, Rule 1 clause 3).
    for (const raw of ['groups', 'savings', 'shares', 'CLIENTS', '']) {
      queryParams.next(convertToParamMap({ scope: raw }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(calls.at(-1)?.resource, `scope=${raw}`).toBe('all');
    }

    queryParams.next(convertToParamMap({}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.resource).toBe('all');

    queryParams.next(convertToParamMap({ scope: 'clients' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.resource).toBe('clients');

    queryParams.next(convertToParamMap({ scope: 'loans' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls.at(-1)?.resource).toBe('loans');
    expect(component.scope()).toBe('loans');
    expect(calls).toHaveLength(9);
  });

  it('renders legacy’s block list, one block per result, with the values each block carries', () => {
    const rendered = blocks();

    expect(rendered).toHaveLength(2);
    expect(component.rows()).toHaveLength(2);
    // A client result names the client, its account number and the office it is filed under, which is what legacy prints on that family's line (`app/views/search/glresults.html:32-34,57-59`).
    expect(component.rows()[0]).toMatchObject({
      kind: 'client',
      name: 'Ada Okafor',
      accountNo: '000000002',
      printsAccountNo: true,
      parentName: 'Head Office',
      parentLabelKey: 'label.heading.office',
      permission: 'READ_CLIENT',
    });
    // A loan result names the loan product, its account number and the client that owns it, which the same line labels `Client` (`app/views/search/glresults.html:63-64`).
    expect(component.rows()[1]).toMatchObject({
      kind: 'loan',
      name: 'Parity Loan',
      accountNo: '000000011',
      printsAccountNo: true,
      parentName: 'Ada Okafor',
      parentLabelKey: 'label.heading.client',
      permission: 'READ_LOAN',
    });

    // Each block carries the name, the account segment and the entity and parent line, in that order: the account number is unprefixed by any column heading and the family is the legacy word.
    expect(text(rendered[0])).toContain('| #000000002');
    expect(text(rendered[0])).toContain('Entity:Client');
    expect(text(rendered[0])).toContain('| Office:Head Office');
    expect(text(rendered[1])).toContain('| #000000011');
    expect(text(rendered[1])).toContain('Entity:Loan');
    expect(text(rendered[1])).toContain('| Client:Ada Okafor');

    // Nothing the legacy results list does not render is added: no table, no column headers, no status indicator and no card title (Rule 1 clause 3; AAP 0.10.5's register holds no entry for any of them).
    expect(host().querySelector('table')).toBeNull();
    expect(host().querySelector('thead')).toBeNull();
    expect(host().querySelector('app-status-swatch')).toBeNull();
    expect(host().querySelector('.panel-title')).toBeNull();
    expect(host().querySelector('.panel-heading')).toBeNull();
  });

  it('drops a row whose entityType is outside the in-scope families and keeps the rows beside it', async () => {
    answer = () => of<SearchResult[]>([CLIENT, UNMAPPED_ROW as SearchResult, LOAN]);
    params.next(convertToParamMap({ query: 'Parity' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The search's three scopes ask Fineract for clients, client identifiers and loans only (`toResourceParam`), so a savings or group row an answer happens to carry belongs to a scope this control never requests and paints no block here (AAP 0.10.5 item 9).
    expect(component.rows()).toHaveLength(2);
    expect(blocks()).toHaveLength(2);
    expect(component.rows().map((row) => row.name)).toEqual([CLIENT.entityName, LOAN.entityName]);
    expect(blocks().map((block) => text(block))).toEqual([
      expect.stringContaining('Ada Okafor'),
      expect.stringContaining('Parity Loan'),
    ]);
    // The dropped row reaches no cell of any block the screen paints.
    expect(text(host())).not.toContain(UNMAPPED_ROW_NAME);
  });

  it('opens the screen’s own page container around its card', () => {
    // The shell leaves the page container to the screen: it wraps only the breadcrumb in a `.container-fluid` of its own and renders the routed view bare (`core/layout/shell.component.html:50-59`), so this screen opens the same `.container-fluid > .row > .col-md-12` wrapper every sibling screen opens, with the card inside it.
    expect(
      host().querySelector('.container-fluid > .row > .col-md-12 > .panel.panel-default'),
    ).not.toBeNull();
    expect(host().querySelector('.panel > .panel-body')).not.toBeNull();
  });

  it('carries the screen’s own title as one invisible h1, from the bundle’s own heading', () => {
    const body = host().querySelector('.panel-body');
    const heading = body?.firstElementChild;

    // Exactly one level-1 heading, and it opens the card, so the results sit under a page title
    // instead of under no heading at all; `sr-only` keeps it off the screen.
    expect(host().querySelectorAll('h1')).toHaveLength(1);
    expect(heading?.tagName).toBe('H1');
    expect(heading?.classList.contains('sr-only')).toBe(true);
    expect(heading?.textContent?.trim()).toBe(LABELS['label.heading.search']);
  });

  it('names the parent by the label each family uses and prints no account number on an identifier match', async () => {
    answer = () => of([CLIENT, LOAN, IDENTIFIER]);
    params.next(convertToParamMap({ query: 'Parity' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Legacy's three lines: a client's parent is its office, a loan's and an identifier match's is the client, and only the first two carry an account number (`app/views/search/glresults.html:11-64`).
    expect(component.rows().map((row) => row.parentLabelKey)).toEqual([
      'label.heading.office',
      'label.heading.client',
      'label.heading.client',
    ]);
    expect(component.rows().map((row) => row.printsAccountNo)).toEqual([true, true, false]);

    // The identifier's block therefore shows the client it matched and no `#` segment at all.
    const identifierBlock = blocks()[2];

    expect(text(identifierBlock)).toContain('Entity:Client');
    expect(text(identifierBlock)).toContain('| Client:Ada Okafor');
    expect(text(identifierBlock)).not.toContain('#');

    expect(new Set(component.rows().map((row) => row.key)).size).toBe(3);
  });

  it('cuts an answer longer than 200 results to legacy’s first 201 and shows the bundle’s notice', async () => {
    answer = () => of(clientResults(202));
    params.next(convertToParamMap({ query: 'Client' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Legacy's controller slices the answer to its first 201 and raises its flag (`app/scripts/controllers/main/SearchController.js:10-18`), and the results list prints the bundle's own message above the rows it kept.
    expect(component.exceedsMaxLength()).toBe(true);
    expect(blocks()).toHaveLength(201);
    expect(text(blocks()[200])).toContain('Client 201');
    expect(text(blocks()[200])).not.toContain('Client 202');
    expect(host().querySelector('#search-results-truncated')?.textContent?.trim()).toBe(
      TRUNCATED_TEXT,
    );
  });

  it('renders an answer of 200 results whole and shows no notice', async () => {
    answer = () => of(clientResults(200));
    params.next(convertToParamMap({ query: 'Client' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Legacy's own boundary: `data.length > 200` is the test, so an answer of exactly 200 is neither cut nor announced (`SearchController.js:10-11`).
    expect(component.exceedsMaxLength()).toBe(false);
    expect(blocks()).toHaveLength(200);
    expect(host().querySelector('#search-results-truncated')).toBeNull();
  });

  it('renders an answer of 201 results whole but already reports the truncation legacy reports', async () => {
    answer = () => of(clientResults(201));
    params.next(convertToParamMap({ query: 'Client' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Legacy tests `data.length > 200` BEFORE it slices, so 201 results are both all rendered — `data.slice(0, 201)` keeps every one of them — and announced by the bundle's notice (`SearchController.js:10-12`; Rule 1 clause 3).
    expect(component.exceedsMaxLength()).toBe(true);
    expect(blocks()).toHaveLength(201);
    expect(text(blocks()[200])).toContain('Client 201');
    expect(host().querySelector('#search-results-truncated')?.textContent?.trim()).toBe(
      TRUNCATED_TEXT,
    );
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
    expect(component.rows()[0]?.parentName).toBe('Ada Okafor');
    expect(component.rows()[0]?.printsAccountNo).toBe(false);
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
    expect(blocks()).toHaveLength(2);
    expect(host().querySelector('.panel')).not.toBeNull();
    expect(host().querySelector('.panel-body')).not.toBeNull();
  });

  for (const { label, failure } of SILENT_FAILURES) {
    it(`renders no text for ${label}, which the interceptor reports on its own`, async () => {
      answer = () => throwError(failure);
      params.next(convertToParamMap({ query: 'Parity' }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(calls).toHaveLength(2);
      expect(component.error()).toBeNull();
      expect(host().querySelector('#search-results-error')).toBeNull();
      expect(component.isEmpty()).toBe(false);
      expect(host().querySelector('#search-results-empty')).toBeNull();
      expect(blocks()).toHaveLength(2);
    });
  }

  it('replaces the results with exactly one new request when the parameters change', async () => {
    expect(calls).toHaveLength(1);

    answer = () => of([CLIENT]);
    params.next(convertToParamMap({ query: 'Ada' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toHaveLength(2);
    expect(component.query()).toBe('Ada');
    expect(blocks()).toHaveLength(1);
    expect(component.error()).toBeNull();
  });

  it('lists a loan row to a user without READ_LOAN but does not offer the link', async () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_CLIENT']);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const loanRow = blocks()[1];
    const anchor = loanRow?.querySelector('a');
    const plain = loanRow?.querySelector('span');

    expect(anchor?.style.display).toBe('none');
    expect(plain?.style.display).not.toBe('none');
    expect(plain?.textContent?.trim()).toBe('Parity Loan');
    expect(blocks()[0]?.querySelector('a')?.style.display).not.toBe('none');
  });

  it('lists a client row to a user without READ_CLIENT but does not offer the link', async () => {
    TestBed.inject(PermissionsService).setPermissions(['READ_LOAN']);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const clientRow = blocks()[0];
    const anchor = clientRow?.querySelector('a');
    const plain = clientRow?.querySelector('span');

    expect(anchor?.style.display).toBe('none');
    expect(plain?.style.display).not.toBe('none');
    expect(plain?.textContent?.trim()).toBe('Ada Okafor');
    expect(blocks()[1]?.querySelector('a')?.style.display).not.toBe('none');
  });

  it('survives a failure and searches again afterwards', async () => {
    answer = () => throwError(() => new ApiError('Server is unavailable', 500));
    params.next(convertToParamMap({ query: 'first' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // A 5xx carries no text for this screen: it is the interceptor's notification alone (AAP 0.7.4).
    expect(component.error()).toBeNull();
    expect(host().querySelector('#search-results-error')).toBeNull();
    expect(blocks()).toHaveLength(2);

    answer = () => of([CLIENT]);
    params.next(convertToParamMap({ query: 'second' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(blocks()).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });
});
