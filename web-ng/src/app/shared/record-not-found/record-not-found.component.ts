import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** The single presentation of a record that could not be read, shared by every record screen that implements one (AAP 0.7.4 "States every list and record screen must implement"): a 404 from `GET /clients/{id}`, `GET /loans/{id}` or `GET /savingsaccounts/{id}`, and a record route that names no id, render this message in place of the record and leave the rest of the shell usable. Both strings are keys the shipped legacy bundles already carry — `label.heading.notavailable` ("Not Available" in en) and `error.msg.resource.not.found` ("The requested resource is not available." in en) — so the registered missing-translation handler never has to humanise one, and no user-facing copy is written into
 * this component (Rule 1 clauses 3 and 6; AAP 0.3.1). It adds no status word, tooltip, title, icon, retry or navigation control: the message is the whole of what a screen says about a record it does not have, and a status or an offer the design does not show would be an improvement the request forbids (AAP 0.10.5 item 11; Rule 1 clause 3). Every visual value comes from the global Bootstrap 3 layer `web-ng/src/styles.scss` compiles, so the component declares no styles of its own. */
@Component({
  selector: 'app-record-not-found',
  imports: [TranslatePipe],
  templateUrl: './record-not-found.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordNotFoundComponent {}
