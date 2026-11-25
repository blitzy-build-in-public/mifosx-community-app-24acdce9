/**
 * Validation of the two kinds of value a Fineract request writes as a path segment: a resource
 * identifier and a datatable's registered table name.
 *
 * **Why a guard exists at all.** `AppConfigService.apiUrl()` joins the configured base, the API root
 * and a service's relative path as given — no encoding, no decoding, no `new URL()` parsing — because
 * the URL a service sends has to be byte-identical to the one the legacy application sent
 * (Rule 1 clause 2; AAP 0.1.1 "Parity is behavioural, not visual"). That leaves the segment itself
 * unguarded, and a segment is where a crafted value does the damage: an identifier arrives
 * URL-decoded from the Angular router, the WHATWG URL parser strips dot-segments out of an http(s)
 * URL, so a route value such as `..%2F..%2F..%2Fusers` reaches Fineract as `../../../users` and moves
 * the request off the `/api/v1` root to another path on the same host, under the user's credential
 * (CWE-20, CWE-22).
 *
 * **Why a format check rather than an encoding.** Percent-encoding the segment would change the URL
 * a valid identifier produces, and every valid identifier already has the one shape Fineract defines
 * for it. So a value that holds that shape is written exactly as the legacy application wrote it, and
 * a value that does not is refused before any request is composed. The refusal is a plain `Error`
 * from here; the caller raises it inside an RxJS `defer` so it reaches the caller of the service as an
 * observable error rather than an exception thrown out of a `switchMap` projection, which is why
 * these functions are synchronous and allocation-free.
 */

/**
 * The only shape a Fineract resource identifier takes: one or more ASCII digits.
 *
 * `\d` in a JavaScript pattern matches the ASCII digits alone (no Unicode decimal digits), and the
 * anchors make the pattern a statement about the whole segment. A negative number, a decimal, an
 * exponent form such as `1e+21`, an empty string, a slash, a dot segment and a percent-encoded form
 * are all outside the pattern, so refusing them needs no case of its own.
 */
const RESOURCE_ID_PATTERN = /^\d+$/;

/**
 * The only shape a Fineract datatable's registered table name takes: ASCII letters, digits and
 * underscores, as in `client_extra_details`.
 *
 * The name comes from the server's own `entityDatatableChecks` answer rather than from a route, so
 * this is a check on a value the application did not build itself; a slash, a dot segment or a space
 * is outside the pattern and is refused rather than composed into the gate's read path.
 */
const DATATABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * The path segment a Fineract resource identifier is written as, or a refusal to build one.
 *
 * A service calls this where it composes an identifier into its URL — `clients/${…}`, `loans/${…}`,
 * `savingsaccounts/${…}`, `datatables/{table}/${…}` — and passes a `source` naming the call, so the
 * refusal a caller sees says which request it stopped. A numeric id and a route parameter that holds
 * digits both produce the digits alone, which is byte-identical to the segment the legacy application
 * sent (Rule 1 clause 2).
 *
 * @param id the identifier as the caller holds it — a numeric id from a payload, or a `:id` route
 * parameter, which the router hands over decoded.
 * @param source the call composing the segment, e.g. `'ClientService.get'`, quoted back in the error.
 * @returns the identifier's own text, which is its path segment unchanged.
 * @throws Error when the value is not one or more ASCII digits. Such a value could move the request
 * to another path on the same host, so no request is issued for it.
 */
export function resourceId(id: number | string, source: string): string {
  const segment = String(id);

  if (!RESOURCE_ID_PATTERN.test(segment)) {
    throw new Error(
      `PathSegment.resourceId: ${source} was given the identifier '${segment}', which is not a Fineract ` +
        'resource identifier. Fineract identifiers are one or more ASCII digits, and a path segment of any ' +
        'other shape can move the request to another path on the same host, so no request has been issued.',
    );
  }

  return segment;
}

/**
 * The path segment a registered datatable's name is written as, or a refusal to build one.
 *
 * The gate reads each checked table through `datatables/{table}/{clientId}`, and the table name in
 * that path comes from the `entityDatatableChecks` answer, so the same check the identifier gets is
 * applied to it here. A name Fineract itself registered is written unchanged — no encoding, because
 * the legacy gate sent it as-is (Rule 1 clause 2) — and anything else is refused before the read is
 * composed.
 *
 * @param name the `datatableName` a check row carries.
 * @param source the call composing the segment, e.g. `'DataTableGateService.checkClientActionGate'`.
 * @returns the table name, which is its path segment unchanged.
 * @throws Error when the name is not one or more ASCII letters, digits or underscores. Such a value
 * could move the read to another path on the same host, so no request is issued for it.
 */
export function datatableName(name: string, source: string): string {
  if (!DATATABLE_NAME_PATTERN.test(name)) {
    throw new Error(
      `PathSegment.datatableName: ${source} was given the datatable name '${name}', which is not a ` +
        'Fineract table name. Registered table names are one or more ASCII letters, digits or underscores, ' +
        'and a path segment of any other shape can move the request to another path on the same host, so no ' +
        'request has been issued.',
    );
  }

  return name;
}
