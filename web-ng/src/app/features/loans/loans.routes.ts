/** The loans feature's six legacy paths, hash-root-relative, mounted by `app.routes.ts` through a pathless `loadChildren` inside the `ShellComponent` layout route, so the five screens land in the lazy loans chunk, with every path spelling the legacy segment verbatim (AAP 0.8.2, AAP 0.4.4, AAP 0.10.4, AAP 0.14.1). */
import type { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';
import { LoanActionComponent } from './loan-action/loan-action.component';
import { LoanChargeFormComponent } from './loan-charge-form/loan-charge-form.component';
import { LoanEditComponent } from './loan-edit/loan-edit.component';
import { LoanNewComponent } from './loan-new/loan-new.component';
import {
  LOAN_ACTION_PERMISSIONS,
  LOAN_CHARGE_PERMISSION,
  LoanViewComponent,
} from './loan-view/loan-view.component';

/** The loans family's six paths under their legacy URLs, exported as the array `app.routes.ts` loads lazily. */
export const LOANS_ROUTES: Routes = [
  /** Workflow W4, and W7's validation error: the application form with its repayment preview, for the route's `clientId`. */
  {
    path: 'newclientloanaccount/:clientId',
    component: LoanNewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'CREATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanapplication'],
    },
  },
  /** Workflow W4's edit step: the form that changes an application the server has not yet approved, named by the route's `id`. */
  {
    path: 'editloanaccount/:id',
    component: LoanEditComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'UPDATE_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.editloanaccount'],
    },
  },
  /** The loan record named by the route's `id`: summary, repayment schedule, transactions and charges, and the way into W5 and W6. */
  {
    path: 'viewloanaccount/:id',
    component: LoanViewComponent,
    canActivate: [permissionGuard],
    data: {
      permission: 'READ_LOAN',
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /** One action's form for the loan the route's `id` names, selected by `action`: approve, undoapproval, reject, disburse and undodisbursal are W5, `repayment` is W6. The declaration below names exactly those six segments, so a segment naming no command is refused by `permissionGuard` before this screen mounts, exactly as a code the user does not hold is — fail closed, and the navigation lands on the clients list (AAP 0.1.1, AAP 0.14.1), the same shape `clients.routes.ts` gives `client/:id/:action`. The screen keeps its own not-found branch for the states the guard cannot judge (a 404 from the mode's seed read). The segment also selects the code the screen requires — `LOAN_ACTION_PERMISSIONS`, the declaration the loan record's own action links read — so the link that opens a command and this route's guard ask for the same code (AAP 0.1.1, AAP 0.4.2), and it is the code Fineract enforces for that command rather than a broader one (Rule 1 clause 3). */
  {
    path: 'loanaccount/:id/:action',
    component: LoanActionComponent,
    canActivate: [permissionGuard],
    data: {
      permission: { param: 'action', codes: LOAN_ACTION_PERMISSIONS },
      breadcrumb: ['label.anchor.loans', 'label.heading.loanaccount'],
    },
  },
  /** The add-charge form for the loan the route's `id` names (AAP 0.7.3 row "Loan charges"), gated on `LOAN_CHARGE_PERMISSION` — the code the loan record's Add Loan Charge link carries — so the link and the screen it opens are one permission (AAP 0.1.1, AAP 0.14.1). */
  {
    path: 'addloancharge/:id',
    component: LoanChargeFormComponent,
    canActivate: [permissionGuard],
    data: {
      permission: LOAN_CHARGE_PERMISSION,
      breadcrumb: ['label.anchor.loans', 'label.heading.addloancharge'],
    },
  },
  /** Pay or waive one charge of the loan the route's `id` names: `action` is `pay` or `waive`, `chargeId` is the loan charge's own id (AAP 0.7.3 row "Loan charges"). */
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
