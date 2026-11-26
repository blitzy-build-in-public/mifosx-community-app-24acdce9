/** The status vocabulary the whole application shares, and the single mapping from a Fineract status code onto it (AAP 0.2.3 `StatusSwatch` row; AAP 0.7.2 rows `Client`, `ClientAccountSummary`, `LoanAccount`, `SavingsAccount`; AAP 0.11.1 row for `web-ng/src/app/shared/**`; AAP 0.14.1, Rule 1 clause 6, AAP 0.4.4). */

/** The six keys of the status indicator, and the whole of its vocabulary: the three states the design paints — `active`, `pending` and `closed` — the two terminal states Fineract records separately, `rejected` and `withdrawn`, and `other`, the fallback for a state the vocabulary names no colour of its own for. The two extra keys are what AAP 0.5.4's "legacy status classes" require, because legacy's `StatusLookup` gives each state a class of its own — `statusrejected` and `statuswithdraw` beside `statusactive`, `statuspending` and `statusclosed` (`app/scripts/filters/StatusLookup.js:21-25`) — and a state with no key would have to share another state's colour (AAP 0.2.3 `StatusSwatch` row, AAP 0.5.4 row "Status indicator", AAP 0.10.5 item 11). */
export type StatusKey = 'active' | 'pending' | 'closed' | 'rejected' | 'withdrawn' | 'other';

/** Every legal `StatusKey` in one place, against which a key derived from a payload is validated before it reaches the indicator element's class list (AAP 0.2.3 `StatusSwatch` row): the component validates an input against it and `toStatusKey` in this same file can only answer with a member of it, so the component and the mapping cannot disagree about what a key is. */
export const STATUS_KEYS: ReadonlySet<StatusKey> = new Set<StatusKey>(['active', 'pending', 'closed', 'rejected', 'withdrawn', 'other', ]);

/** The status codes this application recognises, mapped onto the indicator's colour keys — the union of the four tables the three families and the global search screen kept before this module: `active` → `active` (AAP 0.2.3). The closed family — `closed` and every closure variant, `matured` included — paints `closed`, while the two states that end an application without closing it paint a key each: `rejected` paints `rejected`, and every spelling of a withdrawal — `withdraw`, `withdrawnbyclient`, `withdrawnbyapplicant` — paints `withdrawn`, exactly as legacy gives each of the two a status class of its own (`app/scripts/filters/StatusLookup.js:23-24`; AAP 0.5.4). All three are terminal states, but only one of them is closed: the clients list's "Show Closed" checkbox hides the `closed` code alone and leaves the other two on screen (AAP 0.7.4), so each terminal state has to be tellable apart from the others it sits beside. `other` therefore stays the fallback for the states the vocabulary names no colour of its own for — a transfer in progress or on hold, an invalid record, a savings account overpaid, a code no enumeration declares, and an empty or absent one. Every value is a member of {@link StatusKey}, and neither a status word nor a colour is introduced here (AAP 0.10.5 item 11). */
const STATUS_KEY_BY_CODE: Readonly<Partial<Record<string, StatusKey>>> = {
  active: 'active',
  pending: 'pending', submittedandpendingapproval: 'pending', approved: 'pending',
  closed: 'closed', closedobligationsmet: 'closed', closedrescheduleoutstandingamount: 'closed', closedwrittenoff: 'closed',
  prematureclosure: 'closed', matured: 'closed',
  rejected: 'rejected', withdraw: 'withdrawn', withdrawnbyclient: 'withdrawn', withdrawnbyapplicant: 'withdrawn', };

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
