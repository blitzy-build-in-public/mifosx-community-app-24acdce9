/** The status vocabulary the whole application shares, and the single mapping from a Fineract status code onto it (AAP 0.2.3 `StatusSwatch` row; AAP 0.7.2 rows `Client`, `ClientAccountSummary`, `LoanAccount` (AAP 0.11.1, AAP 0.14.1, Rule 1 clause 6, AAP 0.4.4). */

/** The four keys of the status indicator, and the whole of its vocabulary (AAP 0.2.3 `StatusSwatch` row, whose Props Interface column fixes exactly this union). */
export type StatusKey = 'active' | 'pending' | 'closed' | 'other';

/** Every legal `StatusKey` in one place, against which a key derived from a payload is validated before it reaches the indicator element's class list (AAP 0.2.3 `StatusSwatch` row): the component validates an input against it and `toStatusKey` in this same file can only answer with a member of it, so the component and the mapping cannot disagree about what a key is. */
export const STATUS_KEYS: ReadonlySet<StatusKey> = new Set<StatusKey>(['active', 'pending', 'closed', 'other', ]);

/** The status codes this application recognises, mapped onto the indicator's colour keys — the union of the four tables the three families and the global search screen kept before this module: `active` → `active` (AAP 0.2.3). */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  pending: 'pending', submittedandpendingapproval: 'pending', approved: 'pending',
  closed: 'closed', closedobligationsmet: 'closed', closedrescheduleoutstandingamount: 'closed', closedwrittenoff: 'closed',
  prematureclosure: 'closed', matured: 'closed', rejected: 'closed', withdraw: 'closed', withdrawnbyclient: 'closed',
  withdrawnbyapplicant: 'closed', };

/** The one normalisation a Fineract status code is put through before it is looked up, used by all three families and the global search screen so that one code has exactly one key: lower-cased, a leading. */
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
