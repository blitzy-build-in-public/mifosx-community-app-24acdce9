/**
 * The loans feature's route group — the six legacy paths of the individual-loan workflows W4 to W7,
 * declared in full and mounted by `app.routes.ts` on the empty path, so each URL is exactly the legacy
 * URL it cuts over (AAP 0.8.2 "Feature routes, matching legacy paths exactly"; AAP 0.7.1 Features row
 * `loans`; AAP 0.7.3 rows W4, W5, W6 and W7; `web-ng/tools/parity/in-scope-routes.json`).
 *
 * | Path | Screen | Access code |
 * |---|---|---|
 * | `newclientloanaccount/:clientId` | the application form with its repayment preview | `CREATE_LOAN` |
 * | `editloanaccount/:id` | the edit form | `UPDATE_LOAN` |
 * | `viewloanaccount/:id` | the record, with its schedule, transactions and charges entry points | `READ_LOAN` |
 * | `loanaccount/:id/:action` | one action's form — `approve`, `undoapproval`, `reject`, `disburse`, `undodisbursal`, `repayment` | `UPDATE_LOAN` |
 * | `addloancharge/:id` | the loan's add-charge form | `UPDATE_LOAN` |
 * | `loanaccountcharge/:id/:action/:chargeId` | pay or waive one charge | `UPDATE_LOAN` |
 *
 * **The codes are the ones the screens already state.** `UPDATE_LOAN` is the code
 * `LoanActionComponent` records for `loanaccount/:id/:action` (`#/loanaccount/:id/:action` "by
 * `loans.routes.ts` under the `UPDATE_LOAN` permission"), and the charge screens change the loan, so
 * they are gated on the same write code. Reading a record is `READ_LOAN`, and applying for one is
 * `CREATE_LOAN`. Each route states its code in `data['permission']`, which is the one declaration
 * `permissionGuard` and the navigation read (AAP 0.14.1).
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
  {
    path: 'newclientloanaccount/:clientId',
    component: LoanNewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanapplication'],
    },
  },
  {
    path: 'editloanaccount/:id',
    component: LoanEditComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.editloanaccount'],
    },
  },
  {
    path: 'viewloanaccount/:id',
    component: LoanViewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  {
    path: 'loanaccount/:id/:action',
    component: LoanActionComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  {
    path: 'addloancharge/:id',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.addloancharge'],
    },
  },
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
