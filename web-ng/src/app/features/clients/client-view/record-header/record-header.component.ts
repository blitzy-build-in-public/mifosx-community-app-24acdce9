import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { toClientStatusKey, type Client } from '../../client.models';
import {
  StatusSwatchComponent,
  type StatusKey,
} from '../../../../shared/status-swatch/status-swatch.component';

/**
 * One `Key: value` run of the record header's inline metadata strip.
 *
 * The two members are display strings: `label` is carried by this component and `value` is
 * whatever the client record holds, including the empty string for a field the record does not
 * fill. It is declared here rather than in `client.models.ts` because it describes the header's
 * own layout, not a Fineract payload.
 */
export interface RecordHeaderField {
  /** Key shown before the colon, e.g. `'Client Number'`. */
  readonly label: string;

  /** Value shown after the colon as the record holds it; empty when the record has none. */
  readonly value: string;
}

/**
 * The header block of the individual client record: the status indicator, the client's name and
 * the three inline `Key: value` runs, separated by pipe glyphs and closed by the section rule
 * (AAP 0.2.3 component inventory row `RecordHeader`; AAP 0.7.1 features row `clients`, which
 * places it inside `ClientViewComponent`).
 *
 * Presentational only. The record is already loaded by the client view screen and arrives through
 * the `client` input, so this component issues no request, holds no state, formats no date and
 * knows nothing of a URL or a tenant (AAP 0.4.2, Rule 1 clauses 2 and 5). The status is the design's
 * colour indicator and never its word, so it goes through `StatusSwatchComponent` in its `dot`
 * geometry and the server's own status label is never read (AAP 0.10.5 deliberate difference 11,
 * Rule 1 clause 3). Every colour, size and rule belongs to the global stylesheet, which is why the
 * component declares no styles of its own (AAP 0.4.4 decision 4, Rule 1 clause 6).
 *
 * Figma: file `DKm5TBFbXypfqyx4xUdhBw`, frame `2:2` ("Legacy"), flow "Sign in and open a client
 * record", step 3 of 3 — the individual client view, screen `1:4` (held in the file as raster
 * layer `17:9`).
 */
@Component({
  selector: 'app-record-header',
  imports: [StatusSwatchComponent],
  templateUrl: './record-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordHeaderComponent {
  /** The already-loaded client record this header renders; the caller owns fetching it. */
  readonly client = input.required<Client>();

  /**
   * The indicator key for the record's status, mapped from the Fineract status *code* rather than
   * from its display value (AAP 0.2.3 row `StatusSwatch`, AAP 0.7.2 row `Client`). The mapping is
   * the one the clients list uses, so a record and its row in the list paint the same colour.
   */
  protected readonly statusKey = computed<StatusKey>(() =>
    toClientStatusKey(this.client().status.code),
  );

  /**
   * The three runs of the metadata strip, in the design's order (AAP 0.2.3 row `RecordHeader`,
   * AAP 0.2.1 step 3): client number, external id and staff.
   *
   * A member the record leaves unset becomes the empty string rather than a placeholder, so the
   * run paints its key with nothing after the colon, exactly as the design shows it, and a value is
   * never invented (AAP 0.7.4, Rule 1 clause 3). The three labels are display strings held in this
   * one place — the wording of the strip has a single home, and resolving them through the legacy
   * translation keys later is a change to this computed alone, which is why they are not threaded
   * through a service here.
   */
  protected readonly metadataRuns = computed<readonly RecordHeaderField[]>(() => {
    const client = this.client();

    return [
      { label: 'Client Number', value: client.accountNo },
      { label: 'External ID', value: client.externalId ?? '' },
      { label: 'Staff', value: client.staffName ?? '' },
    ];
  });
}
