import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { toClientStatusKey, type Client } from '../../client.models';
import type { StatusKey } from '../../../../shared/status-key.util';
import { StatusSwatchComponent } from '../../../../shared/status-swatch/status-swatch.component';

/** One `Key: value` run of the record header's metadata strip; `labelKey` is the legacy bundle key the legacy record template binds (`app/views/clients/viewclient.html`), resolved by `TranslatePipe`. */
export interface RecordHeaderField {
  /** Legacy translation key shown before the colon, e.g. `'label.heading.clientno'`, resolved in the template so the wording follows the active language (Rule 1 clause 6, AAP 0.10.2). */
  readonly labelKey: string;
  /** Value shown after the colon as the record holds it; empty when the record has none. */
  readonly value: string;
}

/** The record's header block: the status indicator, the client's name and the three inline `Key: value` runs (AAP 0.2.3 row `RecordHeader`; Figma screen `1:4`); presentational, and the status is the swatch alone, never its word (AAP 0.10.5 item 11). */
@Component({
  selector: 'app-record-header',
  imports: [StatusSwatchComponent, TranslatePipe],
  templateUrl: './record-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordHeaderComponent {
  /** The already-loaded client record this header renders; the caller owns fetching it. */
  readonly client = input.required<Client>();
  /** The indicator key for the record's status, mapped from the Fineract status *code* rather than its display value, so a record and its list row paint the same colour (AAP 0.2.3, AAP 0.7.2). */
  protected readonly statusKey = computed<StatusKey>(() =>
    toClientStatusKey(this.client().status.code),
  );

  /** The three runs of the metadata strip in the design's order — client number, external id, staff — each an unset member painted as the empty string rather than a placeholder (AAP 0.2.1 step 3; AAP 0.7.4). */
  protected readonly metadataRuns = computed<readonly RecordHeaderField[]>(() => {
    const client = this.client();

    return [
      { labelKey: 'label.heading.clientno', value: client.accountNo },
      { labelKey: 'label.input.externalid', value: client.externalId ?? '' },
      { labelKey: 'label.input.staff', value: client.staffName ?? '' },
    ];
  });
}
