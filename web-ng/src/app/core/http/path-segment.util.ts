/** Validation of the two kinds of value a Fineract request writes as a path segment: a resource identifier and a datatable's registered table name. **Why a guard exists at all.** `AppConfigService.apiUrl()` joins the base, the API root and the caller's path with one separator at each join, so a value that escapes its own segment would address another resource on the same host (Rule 1 clause 2, AAP 0.1.1, Rule 1 clause 3). */

/** The only shape a Fineract resource identifier takes: one or more ASCII digits. */
const RESOURCE_ID_PATTERN = /^\d+$/;

/** The only shape a Fineract datatable's registered table name takes: ASCII letters, digits and underscores, as in `client_extra_details`. */
const DATATABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/** The sentence a refusal is reported with, one per guarded segment, each naming what the user was doing and nothing else — no rejected value, no call name, no framework concept — because a screen renders it as the message the user reads. */
const RESOURCE_ID_REFUSAL = 'The record could not be opened because its address is not valid.';

const DATATABLE_NAME_REFUSAL =
  'The account action could not be checked because the server named a table that is not valid.';

/** The path segment a Fineract resource identifier is written as, or a refusal to build one (Rule 1 clause 2). */
export function resourceId(id: number | string, source: string): string {
  const segment = String(id);

  if (!RESOURCE_ID_PATTERN.test(segment)) {
    throw new Error(RESOURCE_ID_REFUSAL, {
      cause:
        `PathSegment.resourceId: ${source} was given the identifier '${segment}', which is not a Fineract ` +
        'resource identifier. Fineract identifiers are one or more ASCII digits, and a path segment of any ' +
        'other shape can move the request to another path on the same host, so no request has been issued.',
    });
  }

  return segment;
}

/**
 * Whether a value is a Fineract resource identifier, for a caller that has to decide before it builds a path segment or issues a request at all (Rule 1 clause 2). The pattern is the same one {@link resourceId}
 * refuses with, so this predicate accepts exactly the values that guard writes and refuses exactly the values it refuses: a caller can put the question to the value it was handed — a route segment, an id from a
 * link — and answer it without a request or a `try`/`catch`. Nothing is formatted, trimmed or coerced on the way in beyond the `String()` conversion `resourceId` itself performs, so a padded route segment such
 * as `' 2 '` is refused here just as the guard refuses it. `@param value` the candidate identifier, as a route segment or a model id; `@returns` true when the value is one or more ASCII digits, the only shape a
 * Fineract resource identifier takes.
 */
export function isResourceId(value: number | string): boolean {
  return RESOURCE_ID_PATTERN.test(String(value));
}

/** The path segment a registered datatable's name is written as, or a refusal to build one (Rule 1 clause 2). */
export function datatableName(name: string, source: string): string {
  if (!DATATABLE_NAME_PATTERN.test(name)) {
    throw new Error(DATATABLE_NAME_REFUSAL, {
      cause:
        `PathSegment.datatableName: ${source} was given the datatable name '${name}', which is not a ` +
        'Fineract table name. Registered table names are one or more ASCII letters, digits or underscores, ' +
        'and a path segment of any other shape can move the request to another path on the same host, so no ' +
        'request has been issued.',
    });
  }

  return name;
}
