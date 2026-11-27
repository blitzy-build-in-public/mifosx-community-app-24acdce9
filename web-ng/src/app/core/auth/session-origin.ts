/** The binding between a stored session credential and the API origin it was issued against (AAP 0.4.4 decision 5, AAP 0.7.2 row `SessionData`, Rule 1 clause 9): the one question the interceptor and the restore ask is whether the base this page resolved is the base the stored key belongs to, and these three pure functions are the whole of that decision.
 * It is deliberately free of Angular, of storage and of HTTP: the configuration resolves the bases, `SessionService` keeps the recorded origin, the interceptor presents the credential, and none of them decides on its own what "the same origin" means. */

/** The origin of an API base URL — scheme, host and port — or `null` when the value names no server a credential could be presented to. Reads through the platform `URL` parser inside a `try`, because a base is configuration and may be any string: a bare host such as `localhost:8443`, a relative path such as `./fineract-provider` and every other form that is not an absolute URL give `null` rather than a guessed origin. A scheme other than `http:` or `https:` gives `null` too: an opaque form such as `javascript:` or `data:` parses, but its serialised origin is the literal text `null`, so two unrelated values would compare equal. */
export function apiOriginOf(apiBaseUrl: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  return parsed.origin;
}

/** The two API bases a stored credential is judged against, because the configuration resolves one of them and another release named the other (AAP 0.4.4 decision 5). */
export interface ApiBaseUrls {
  /** The base the configuration resolved for this page: the served `assets/config.json` value with the page URL's `?baseApiUrl=` override applied over it, which is the base every request this page sends is composed from. */
  readonly resolved: string;
  /** The base the served `assets/config.json` itself named, before any page-URL override: the only base no page URL can change, which is why it is the only one a stored credential with no recorded origin may be judged against. */
  readonly served: string;
}

/** The origin a stored credential may be presented to, or `null` when it may not be presented to the resolved base at all. A recorded origin is trusted only where it is the resolved base's own origin — a session issued against backend A is not replayed to backend B (Rule 1 clause 9). A recordless entry is what the legacy screens or an older release wrote, since only this service records an origin, and it may be judged against the served base alone: the served `assets/config.json` is what the deployment published, while a `?baseApiUrl=` override is whatever the page URL carrying it names, so trusting an override here would hand a stored key to any host a crafted link chose. Where neither matches, the credential is withheld rather than the override refused: AAP 0.4.4 decision 5 keeps the page URL authoritative for which backend this page talks to, so the page still loads against the base it named and the user simply signs in again. */
export function credentialOriginFor(recorded: string | null, bases: ApiBaseUrls): string | null {
  const resolved = apiOriginOf(bases.resolved);

  if (resolved === null) {
    return null;
  }

  if (recorded !== null) {
    return recorded === resolved ? resolved : null;
  }

  const served = apiOriginOf(bases.served);

  return served !== null && served === resolved ? resolved : null;
}
