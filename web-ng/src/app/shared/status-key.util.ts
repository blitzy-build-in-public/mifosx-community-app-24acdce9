/**
 * The status vocabulary the whole application shares, and the single mapping from a Fineract status
 * code onto it (AAP 0.2.3 component inventory row `StatusSwatch`; AAP 0.7.2 rows `Client`,
 * `ClientAccountSummary`, `LoanAccount`, `SavingsAccount`; AAP 0.11.1 row for
 * `web-ng/src/app/shared/**`).
 *
 * **One table for three families.** The clients list, the client record header, the client record's
 * accounts table, the global search results screen and the savings record all paint the same
 * indicator, and each of them receives its status code from a different Fineract enum: the fork's
 * `ClientStatus.java` sends `clientStatusType.*`, `LoanStatus.java` sends `loanStatusType.*` and
 * `SavingsAccountStatusType.java` sends `savingsAccountStatusType.*`. Before this module every
 * consumer kept its own table and its own normaliser, which is what let one code be coloured one
 * way on the list and another way on the next screen as the fork's enums grew. The table is now
 * one exact table and each family's mapper is a delegate to it — `toClientStatusKey` and
 * `toAccountStatusKey` in `web-ng/src/app/features/clients/client.models.ts`, `toSavingsStatusKey`
 * in `web-ng/src/app/features/savings/savings.models.ts`, and the three call sites of the global
 * search results screen.
 *
 * **Why `shared/` rather than a feature model.** A feature may depend on `core` and `shared` and
 * never on another feature (AAP 0.14.1), so the clients and loans models cannot take the vocabulary
 * from each other and the global search screen may import neither. Taking it from the
 * `StatusSwatchComponent` module instead put a component in the type graph of every model consumer
 * and would have become a cycle the moment the component imported a model, so the vocabulary and
 * its mapping are declared here as plain types and plain functions.
 *
 * **What this module deliberately does not hold.** No colour: every value of the indicator lives in
 * `web-ng/src/styles.scss` against the legacy status classes, and `StatusSwatchComponent` maps a
 * key onto one of those classes (Rule 1 clause 6; AAP 0.4.4 decision 4). No text: the design paints
 * a swatch and never a word, so nothing here produces a label, a title, a tooltip or an i18n key,
 * and the server's localised `status.value` is never consulted (AAP 0.10.5 item 11, Rule 1
 * clause 3). No Angular import, no injection and no state: a screen maps a code once per row or
 * inside a `computed`, wherever it already holds the payload.
 */

/**
 * The four keys of the status indicator, and the whole of its vocabulary (AAP 0.2.3 component
 * inventory row `StatusSwatch`, whose Props Interface column fixes exactly this union).
 *
 * The design paints two of them — `active` in the clients list's Status column and on the client
 * record header (Figma nodes `1:3` and `1:4`) and `pending` on the list's José Luis Núñez row —
 * as a 12.5px square or a 20.5px dot in a single colour each; `closed` and `other` are the
 * complementary styling for the records the design does not show, and they differ by colour only.
 * No member carries a word, because the indicator carries none.
 */
export type StatusKey = 'active' | 'pending' | 'closed' | 'other';

/**
 * Every legal `StatusKey`, in one place, against which a key derived from a payload is validated
 * before it reaches the indicator element's class list (AAP 0.2.3 row `StatusSwatch`).
 *
 * It lives here rather than inside `StatusSwatchComponent` because the vocabulary is no longer that
 * component's own: the component validates an input against it, and `toStatusKey` in this same file
 * can only ever answer with a member of it. A caller — or a spec — that enumerates the four keys
 * reads this set, so the component and the mapping cannot disagree about what a key is.
 */
export const STATUS_KEYS: ReadonlySet<StatusKey> = new Set<StatusKey>([
  'active',
  'pending',
  'closed',
  'other',
]);

/**
 * The status codes this application recognises, mapped onto the indicator's colour keys — the union
 * of the four tables the three families and the global search screen kept before this module, and
 * nothing else.
 *
 * The keys are the codes' normalised form (see {@link normaliseStatusCode}), so one entry serves
 * every family that spells a state the same way: the client family's `clientStatusType.active`, the
 * loan family's `loanStatusType.active` and the savings family's `savingsAccountStatusType.active`
 * all normalise to `active` and reach the same entry. The codes are the fork's own enum values in
 * `ClientStatus.java`, `LoanStatus.java` and `SavingsAccountStatusType.java`.
 *
 * Recognised codes, by the state they indicate, and the family that sends each:
 *
 *   - `active` → `active`: the client family (`ClientStatus.java`), the loan family for a disbursed
 *     loan (`LoanStatus.java`) and the savings family for an activated account
 *     (`SavingsAccountStatusType.java`);
 *   - `pending` → `pending`, the client family's own pending state;
 *   - `submittedandpendingapproval` → `pending`, the loan and savings families: nothing has been
 *     disbursed or activated yet, so neither is `active`;
 *   - `approved` → `pending`, the loan and savings families: approved is not yet disbursed either;
 *   - `closed` → `closed`, all three families;
 *   - `closedobligationsmet`, `closedwrittenoff`, `closedrescheduleoutstandingamount`,
 *     `prematureclosure`, `matured`, `rejected`, `withdraw`, `withdrawnbyclient` and
 *     `withdrawnbyapplicant` → `closed`, because the design's four-key vocabulary carries one
 *     colour for a finished record and every one of these states is terminal (AAP 0.2.3 row
 *     `StatusSwatch`).
 *
 * Four codes the enums declare are deliberately absent, so they and anything the fork adds later
 * fall to the neutral key: `invalid`, which is not a state; `transferinprogress` and
 * `transferonhold`, transitions this build paints no colour of its own for; and `overpaid`, which
 * the loan family colours on its own record through `toLoanStatusKey` in
 * `web-ng/src/app/features/loans/loan.models.ts` but which the client record's accounts table and
 * the global search screen keep neutral.
 */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',

  pending: 'pending',
  submittedandpendingapproval: 'pending',
  approved: 'pending',

  closed: 'closed',
  closedobligationsmet: 'closed',
  closedrescheduleoutstandingamount: 'closed',
  closedwrittenoff: 'closed',
  prematureclosure: 'closed',
  matured: 'closed',
  rejected: 'closed',
  withdraw: 'closed',
  withdrawnbyclient: 'closed',
  withdrawnbyapplicant: 'closed',
};

/**
 * The one normalisation a Fineract status code is put through before it is looked up, used by all
 * three families and by the global search screen so that one code has exactly one key.
 *
 * Lower-cased, a leading `^[a-z]+statustype.` family prefix removed when the payload carried it,
 * and every non-alphanumeric character stripped, so the whole remaining name is the key — never
 * just its last dot-segment. `CLIENTSTATUSTYPE.ACTIVE` therefore normalises to `active`,
 * `loanStatusType.closed.written.off` to `closedwrittenoff`, `preMatureClosure` to
 * `prematureclosure` and `SAVINGSACCOUNTSTATUSTYPE.ACTIVE` to `active`. The prefix is matched
 * family-agnostically because one response (the client record's accounts table) mixes two families.
 *
 * @param code The `code` member of a status object, as Fineract sent it.
 * @returns The key to look up in {@link STATUS_KEY_BY_CODE}.
 */
export function normaliseStatusCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/^[a-z]+statustype\./, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The status indicator's key for a Fineract status code, from any of the three families — the one
 * mapping every screen and every model delegates to (AAP 0.2.3 row `StatusSwatch`).
 *
 * `StatusSwatchComponent` takes a `StatusKey` and never a Fineract code, so this is where a code
 * becomes the design's colour: the client list and the client record header paint a client's own
 * status through it, the client record's accounts table paints both account families' rows through
 * it, the global search results screen paints client and loan rows through it, and the savings
 * record paints its account through it. The result is a colour and only a colour — no label is
 * returned and no screen may render the status as text (AAP 0.10.5 item 11, Rule 1 clause 3).
 *
 * Failure is neutral, never `active`: a missing code, an empty string, a transition
 * (`invalid`, `transfer.in.progress`, `transfer.on.hold`), an overpaid loan on a surface that keeps
 * it neutral, or any code the fork adds later is `other`, which carries a colour of its own without
 * claiming a state. Pure and total — no I/O, no logging, no throw — so it can run in a template for
 * every row.
 *
 * @param code The `code` of a status object, or `undefined` when a response carried none.
 * @returns One of the four keys `StatusSwatchComponent` renders.
 */
export function toStatusKey(code: string | undefined): StatusKey {
  if (code === undefined) {
    return 'other';
  }

  return STATUS_KEY_BY_CODE[normaliseStatusCode(code)] ?? 'other';
}
