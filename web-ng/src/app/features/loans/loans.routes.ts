/**
 * The loans feature's route group — the six legacy paths of the individual-loan workflows W4 to W7,
 * declared in full and mounted by `app.routes.ts` through a pathless `loadChildren` inside the
 * `ShellComponent` layout route. Every path below is therefore hash-root-relative: it carries no
 * `loans/` prefix, spells the legacy segment verbatim, and the URL the router serves is the hash root
 * joined to the path as written here (AAP 0.8.2 "Feature routes, matching legacy paths exactly";
 * AAP 0.7.1 Features row `loans`; AAP 0.7.3 rows W4, W5, W6 and W7; AAP 0.4.4 decision 1 — the
 * route-by-route cutover keeps each legacy URL).
 *
 * | Path | Screen | Access code | Workflow |
 * |---|---|---|---|
 * | `newclientloanaccount/:clientId` | the application form with its repayment preview | `CREATE_LOAN` | W4, W7 |
 * | `editloanaccount/:id` | the edit form | `UPDATE_LOAN` | W4 |
 * | `viewloanaccount/:id` | the record, with its schedule, transactions and charges | `READ_LOAN` | W5, W6 |
 * | `loanaccount/:id/:action` | one action's form — `approve`, `undoapproval`, `reject`, `disburse`, `undodisbursal`, `repayment` | `UPDATE_LOAN` | W5, W6 |
 * | `addloancharge/:id` | the loan's add-charge form | `UPDATE_LOAN` | charges |
 * | `loanaccountcharge/:id/:action/:chargeId` | pay or waive one charge | `UPDATE_LOAN` | charges |
 *
 * **The array must equal the loans rows of `web-ng/tools/parity/in-scope-routes.json`.** That list
 * holds the same six paths, in the same order, as its rows whose `family` is `loans`; it and this
 * array are two statements of one fact, and `npm run check:wiring` fails when either holds a path the
 * other does not (AAP 0.10.4, criterion 7). A screen is never added here alone, and the list is never
 * extended to accommodate a route added here: when the two disagree, whichever is wrong is corrected.
 *
 * **One array, one lazy chunk.** `app.routes.ts` loads this module through `loadChildren`, so the five
 * component classes and their templates land in the loans chunk rather than in the initial bundle —
 * the mechanism that keeps the build inside `web-ng/angular.json`'s 1.5 MB initial-budget error.
 *
 * **The codes are the ones the screens already state.** `UPDATE_LOAN` is the code
 * `LoanActionComponent` records for `loanaccount/:id/:action` (`#/loanaccount/:id/:action` "by
 * `loans.routes.ts` under the `UPDATE_LOAN` permission"), and the charge screens change the loan, so
 * they are gated on the same write code. Reading a record is `READ_LOAN`, and applying for one is
 * `CREATE_LOAN`. Each route states its code in `data['permission']`, which is the one declaration
 * `permissionGuard` and the navigation read (AAP 0.14.1).
 *
 * **The guard is declared here, on each route.** The shell route in `app.routes.ts` carries
 * `authGuard` alone, and `permissionGuard` answers from the `data['permission']` of the route it is
 * attached to (`core/auth/permission.guard.ts`), so an entry that stated a code without also naming
 * the guard in `canActivate` would leave its screen reachable by any signed-in user and its code
 * purely decorative. Each entry therefore names `permissionGuard` beside the code it declares, which
 * is what makes the route gate and the template gate agree (AAP 0.1.1, AAP 0.7.1, AAP 0.14.1).
 *
 * **The trail is the legacy screens' own.** Each route states its breadcrumb keys in
 * `data['breadcrumb']` — `label.anchor.loans` followed by the screen's own `label.heading.*` key, all
 * of them present in the legacy bundles the shell resolves in place — because the legacy loan screens
 * render that trail in their own templates (`app/views/loans/addloancharge.html:2-5`), and the shell
 * paints a trail only for a route that declares one (Rule 1 clauses 3 and 6).
 *
 * **Two paths, one component.** `addloancharge/:id` and `loanaccountcharge/:id/:action/:chargeId` both
 * render `LoanChargeFormComponent`: the component resolves which of the two it is serving from the
 * route parameters before it issues a request (charge form for the loan, or pay/waive for a named
 * charge), which is why one screen class declares both and this array declares both paths.
 *
 * **Two actions, one screen.** `loanaccount/:id/:action` renders `LoanActionComponent` for all six
 * segments, and for `repayment` that component renders `LoanRepaymentComponent` — the loan repayment
 * screen is therefore reached at `#/loanaccount/:id/repayment`, the legacy URL, and adds no seventh
 * path of its own.
 */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { LoanActionComponent } from './loan-action/loan-action.component';
import { LoanChargeFormComponent } from './loan-charge-form/loan-charge-form.component';
import { LoanEditComponent } from './loan-edit/loan-edit.component';
import { LoanNewComponent } from './loan-new/loan-new.component';
import { LoanViewComponent } from './loan-view/loan-view.component';

/**
 * The loans family's six paths under their legacy URLs.
 *
 * Exported as the array `app.routes.ts` loads lazily, so the family's paths, its access codes and its
 * breadcrumb keys are declared in one place and the parity route list has one thing to agree with.
 */
export const LOANS_ROUTES: Routes = [
  /**
   * Workflow W4: the individual-loan application form and its repayment-schedule preview, for the
   * client the route's `clientId` names. Workflow W7's validation error is rendered here too, from the
   * message Fineract answers a rejected application with.
   */
  {
    path: 'newclientloanaccount/:clientId',
    component: LoanNewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanapplication'],
    },
  },
  /**
   * Workflow W4's edit step: the form that changes an application the server has not yet approved,
   * for the loan the route's `id` names.
   */
  {
    path: 'editloanaccount/:id',
    component: LoanEditComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.editloanaccount'],
    },
  },
  /**
   * The loan's record for the route's `id`: summary, repayment schedule, transactions and charges.
   * It is where workflows W5 and W6 are entered from, and the charge links it carries lead to the two
   * charge paths below.
   */
  {
    path: 'viewloanaccount/:id',
    component: LoanViewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /**
   * One action's form for the loan the route's `id` names, selected by the route's `action`:
   * `approve`, `undoapproval`, `reject`, `disburse` and `undodisbursal` are workflow W5, `repayment`
   * is workflow W6, and every other segment renders the not-found message without posting.
   */
  {
    path: 'loanaccount/:id/:action',
    component: LoanActionComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /**
   * The add-charge form for the loan the route's `id` names (AAP 0.7.3 row "Loan charges").
   */
  {
    path: 'addloancharge/:id',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.addloancharge'],
    },
  },
  /**
   * Pay or waive one charge of the loan the route's `id` names: the route's `action` is `pay` or
   * `waive`, and its `chargeId` is the loan charge's own id (AAP 0.7.3 row "Loan charges").
   */
  {
    path: 'loanaccountcharge/:id/:action/:chargeId',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
];
