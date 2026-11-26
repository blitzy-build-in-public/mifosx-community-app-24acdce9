import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AppConfigService } from '../../../../core/config/app-config.service';
import { fromFineractDate, toFineractDate } from '../../../../shared/date-format.util';
import type { Client } from '../../client.models';

/** One label/value row of the record's summary card (AAP 0.7.4 `#/viewclient/:id`; Figma screen `1:4`), exported so the sibling spec types its expectations against the same declaration. */
export interface ClientSummaryRow {
  /** The legacy translation key the row's key cell binds, resolved in the template so the block follows the language switcher (AAP 0.1.1 requirement 1; Rule 1 clause 6). */
  readonly labelKey: string;
  /** Row value as plain display text; empty when the payload carries none, which renders an empty value column rather than a dash (AAP 0.7.4). */
  readonly value: string;
}

/** The record's read-only summary block inside the `General` tab: the client's fields as label/value rows plus the activation date (AAP 0.7.1; AAP 0.10.1 workflow W3; Figma screen `1:4`), presentational so the screen keeps making the one service call. */
@Component({
  selector: 'app-client-summary',
  imports: [TranslatePipe],
  templateUrl: './client-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientSummaryComponent {
  /** The client record to render, as the parent's `GET /clients/{id}` response projected it; the parent owns loading, the not-found state and errors (AAP 0.7.4). */
  readonly client = input.required<Client>();

  /** Supplies the locale the activation date is rendered in: `activeLocale` is the language the switcher has selected, so the date re-renders with the labels instead of staying in `LOCALE_ID` (AAP 0.7.2 "Date handling"). */
  private readonly config = inject(AppConfigService);

  /** The client's activation date, or `null` while the client is pending: converted from the `FineractDate` triple without a timezone shift, and an absence passed through rather than substituted (Rule 1 clauses 2 and 3). */
  readonly activationDate = computed<Date | null>(() =>
    fromFineractDate(this.client().activationDate),
  );

  /** The activation date as the record displays it: the one `DISPLAY_DATE_FORMAT` pattern rendered in the active locale, so this row reads exactly what the profile card beside it reads — one value, one rendering (AAP 0.7.2 "Date handling"). Empty while the client is pending, which leaves the value column empty rather than carrying a placeholder (AAP 0.7.4; Rule 1 clause 3). */
  readonly activationDateText = computed<string>(() => {
    const date = this.activationDate();

    if (date === null) {
      return '';
    }

    return toFineractDate(date, this.config.activeLocale()) ?? '';
  });

  /** The client's four text rows in the record's fixed order — client number, external id, office, staff — with no derived row and no placeholder for an omitted field (AAP 0.7.4; Rule 1 clause 3). */
  readonly rows = computed<readonly ClientSummaryRow[]>(() => {
    const client = this.client();

    return [
      { labelKey: 'label.heading.clientno', value: client.accountNo },
      { labelKey: 'label.input.externalid', value: client.externalId ?? '' },
      { labelKey: 'label.heading.office', value: client.officeName },
      { labelKey: 'label.input.staff', value: client.staffName ?? '' },
    ];
  });
}
