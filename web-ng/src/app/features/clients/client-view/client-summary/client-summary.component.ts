import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { DISPLAY_DATE_FORMAT, fromFineractDate } from '../../../../shared/date-format.util';
import type { Client } from '../../client.models';

/**
 * One label/value row of the client record's summary: the shape the template iterates for the
 * fixed columns of the record card (AAP 0.7.4 "Client view (`#/viewclient/:id`)"; Figma screen
 * `1:4`).
 *
 * Exported so the sibling spec can type its expectations against the same declaration rather
 * than restating the members.
 */
export interface ClientSummaryRow {
  /** Row label, rendered in the record's bold key column. */
  readonly label: string;

  /**
   * Row value as plain display text. Empty when the payload carries no value for the row's
   * field, which the design renders as an empty value column — never a dash or a placeholder
   * (AAP 0.7.4; Rule 1 clause 3).
   */
  readonly value: string;
}

/**
 * Read-only summary block of the individual client record, inside the `General` tab's work
 * area: the client's own fields as label/value rows, with the activation date as the row the
 * template formats through `DatePipe` (AAP 0.7.1 row `clients` — `ClientViewComponent` with
 * `ClientSummaryComponent`; AAP 0.10.1 workflow **W3**).
 *
 * Presentational and read-only: it renders the `Client` its parent already loaded from
 * `GET /clients/{id}` and issues no request of its own, so the screen keeps making exactly the
 * one call `client.service.ts` owns (AAP 0.4.2; Rule 1 clause 2). It injects no service, no
 * `Router` and no `ActivatedRoute`, holds no state it mutates, and offers no action: every
 * lifecycle action belongs to `client-actions`.
 *
 * Nothing here reads the clock. Each displayed date comes from the payload the parent received,
 * converted with `fromFineractDate` into a local-midnight `Date` so no timezone shift moves an
 * activation onto another day, and the template renders it at `DISPLAY_DATE_FORMAT`
 * (`dd MMMM yyyy`), the pattern the record shows in every language (AAP 0.7.2 "Date handling";
 * Rule 1 clauses 2 and 3). Serialising a date for a payload is `client.service.ts`'s job, so this
 * component sets neither `dateFormat` nor `locale`.
 *
 * Figma: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"), flow "Sign in and open a client
 * record", step 3 of 3 — Individual client view, screen `1:4`, inside the record card. Every
 * visual value of the block — the bold key column (`.value-key`), the common value column, the
 * `14px/20px` body type and the row rhythm — is produced by `web-ng/src/styles.scss`, so this
 * component declares no stylesheet, no inline style and no colour (Rule 1 clause 6).
 */
@Component({
  selector: 'app-client-summary',
  imports: [DatePipe],
  templateUrl: './client-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientSummaryComponent {
  /**
   * The client record to render, as the parent's `GET /clients/{id}` response projected it.
   *
   * The only input: the parent owns the loading, the not-found state and the error handling, so
   * this block always renders a client that exists (AAP 0.7.4 "States every list and record
   * screen must implement").
   */
  readonly client = input.required<Client>();

  /**
   * The one date pattern the record displays, bound by the template as
   * `{{ activationDate() | date: displayDateFormat }}` so an activation reads `21 November 2026`
   * rather than a locale-defaulted `DatePipe` format (AAP 0.7.2 "Date handling").
   */
  readonly displayDateFormat: string = DISPLAY_DATE_FORMAT;

  /**
   * The client's activation date, or `null` while the client is still pending — the state the
   * design shows as a row whose label renders and whose value column is empty.
   *
   * Read from `Client.activationDate`, the field `GET /clients/{id}` sends as a `FineractDate`
   * (`[2026, 11, 21]`), and converted without a timezone shift. A pending client carries no
   * activation date at all, so the absence is passed through rather than substituted
   * (Rule 1 clauses 2 and 3).
   */
  readonly activationDate = computed<Date | null>(() =>
    fromFineractDate(this.client().activationDate),
  );

  /**
   * The client's text rows, in the record's fixed order:
   *
   * 1. `Client Number` — `Client.accountNo`, the zero-padded number printed verbatim;
   * 2. `External ID` — `Client.externalId`, empty when the bank assigned none;
   * 3. `Office` — `Client.officeName`;
   * 4. `Staff` — `Client.staffName`, empty when the client has no loan officer.
   *
   * Four rows and no more: the activation date is the fifth row and the template renders it
   * through `DatePipe`, and no derived row (an age, a tenure) is added, because a computed value
   * the legacy record does not show would be the improvement this migration must not make
   * (AAP 0.7.4; Rule 1 clause 3). A field the payload omits yields `''`, never a dash, `'N/A'`
   * or a translated stand-in.
   */
  readonly rows = computed<readonly ClientSummaryRow[]>(() => {
    const client = this.client();

    return [
      { label: 'Client Number', value: client.accountNo },
      { label: 'External ID', value: client.externalId ?? '' },
      { label: 'Office', value: client.officeName },
      { label: 'Staff', value: client.staffName ?? '' },
    ];
  });
}
