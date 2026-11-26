/** The status vocabulary the whole application shares, and the single mapping from a Fineract status code onto it (AAP 0.2.3 `StatusSwatch` row; AAP 0.7.2 rows `Client`, `ClientAccountSummary`, `LoanAccount`, `SavingsAccount`; AAP 0.11.1 row for `web-ng/src/app/shared/**`; AAP 0.14.1, Rule 1 clause 6, AAP 0.4.4). */

/** The four keys of the status indicator, and the whole of its vocabulary (AAP 0.2.3 `StatusSwatch` row, whose Props Interface column fixes exactly this union). */
export type StatusKey = 'active' | 'pending' | 'closed' | 'other';

/** Every legal `StatusKey` in one place, against which a key derived from a payload is validated before it reaches the indicator element's class list (AAP 0.2.3 `StatusSwatch` row): the component validates an input against it and `toStatusKey` in this same file can only answer with a member of it, so the component and the mapping cannot disagree about what a key is. */
export const STATUS_KEYS: ReadonlySet<StatusKey> = new Set<StatusKey>(['active', 'pending', 'closed', 'other', ]);

/** The status codes this application recognises, mapped onto the indicator's colour keys — the union of the four tables the three families and the global search screen kept before this module: `active` → `active` (AAP 0.2.3). The closed family —
 * `closed` and every closure variant, `matured` included — paints `closed`. A rejected or withdrawn record is a terminal state as well, but it is not a closed one, and it paints `other`: the clients list's "Show Closed" checkbox hides the `closed`
 * code alone and leaves those records on screen (AAP 0.7.4), so the state the checkbox hides has to be tellable apart from the two it keeps, and `other` is the fourth key's own slot for a state the vocabulary names no colour of its own for. Every
 * value is a member of {@link StatusKey}, and neither a status word nor a colour is introduced here (AAP 0.10.5 item 11). */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  pending: 'pending', submittedandpendingapproval: 'pending', approved: 'pending',
  closed: 'closed', closedobligationsmet: 'closed', closedrescheduleoutstandingamount: 'closed', closedwrittenoff: 'closed',
  prematureclosure: 'closed', matured: 'closed',
  rejected: 'other', withdraw: 'other', withdrawnbyclient: 'other', withdrawnbyapplicant: 'other', };

/** The one normalisation a Fineract status code is put through before it is looked up, used by all three families and the global search screen so that one code has exactly one key: lower-cased, a leading `^[a-z]+statustype.` family prefix removed when the payload carried it, and every non-alphanumeric character stripped, so the whole remaining name is the key — never just its last dot-segment. */
export function normaliseStatusCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/^[a-z]+statustype\./, '')
    .replace(/[^a-z0-9]/g, '');
}

/** The status indicator's key for a Fineract status code from any of the three families — the one mapping every screen and model delegates to (AAP 0.2.3 `StatusSwatch` row) (AAP 0.10.5, Rule 1 clause 3). */
export function toStatusKey(code: string | undefined): StatusKey {
  if (code === undefined) {
    return 'other';
  }

  return STATUS_KEY_BY_CODE[normaliseStatusCode(code)] ?? 'other';
}
