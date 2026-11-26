# web-ng — the Angular 22 front end for Mifos X / Apache Fineract

The replacement front end for the legacy Mifos X community app: Angular 22.3.0, standalone components,
hash routing, served on port 4300, calling the same Apache Fineract REST API — same endpoints, headers
and behaviour — as the legacy app, which keeps running on port 9090 so screens cut over route by route.

All new code lives in `web-ng/`, plus `Dockerfile.web-ng` and `docker-compose.web-ng.yml` at the
repository root; `app/`, `test/` and the legacy root `Dockerfile` are read-only.

## Prerequisites

- Node >= 22.22.3 and npm — the engine floor `@angular/*` 22.3.0 declares; the image build stage is `node:22`
- Docker with Compose, for the backend and for the packaging check
- A POSIX shell: every script runs unchanged on macOS and Linux

## Install, build, lint, test

Run every command in this file from `web-ng/`.

```bash
npm install                  # never npm ci; no lockfile is committed
npm run build                # ng build --configuration production -> dist/web-ng/browser
npm run lint                 # ng lint; zero errors
npm test                     # both coverage passes, described below
```

`package-lock.json` is written locally by `npm install` and git-ignored by design; every dependency is
pinned to an exact version in `package.json`. Two gates fail rather than warn: `npm run build` errors
above a 1.5 MB uncompressed initial bundle, and `npm test` runs `ng test web-ng` (65% statements and
lines overall) then `ng test web-ng-services` (90% over `core/http` plus the six Fineract services).

## Run in development

```bash
npx ng serve --port 4300 --host 0.0.0.0   # open http://localhost:4300/ — hash routes, e.g. #/clients
```

Configuration is resolved in three steps, the last winning:

1. `src/assets/config.json` ships the defaults — `apiBaseUrl` `https://localhost:8443`, `tenantId` `default`
2. `API_BASE_URL` and `TENANT_ID` rewrite that file at container start, in `docker/entrypoint.sh`
3. `?baseApiUrl=` and `?tenantIdentifier=` on the page URL override both

## Backend

The only permitted backend is `Blitzy-Sandbox/blitzy-fineract`, built from source into a local
`fineract:latest` image. No downloaded Fineract image and no public demo server (`demo.mifos.io`,
`demo.fineract.dev`) may back either front end.

```bash
git clone https://github.com/Blitzy-Sandbox/blitzy-fineract.git
cd blitzy-fineract && ./gradlew :fineract-provider:jibDockerBuild -x test
docker compose -f docker-compose-postgresql.yml up -d --pull never
```

`--pull never` is mandatory: it stops Docker substituting a downloaded image for the one built
locally. Fineract then answers on `https://localhost:8443/fineract-provider/api/v1` with tenant
`default`, behind a self-signed certificate (`curl -k`; Playwright sets `ignoreHTTPSErrors`).
`npm run reset:db` needs `FINERACT_COMPOSE_FILE`, the absolute path of that clone's
`docker-compose-postgresql.yml`, whose location differs per environment; the script exits non-zero
naming the variable when it is unset.

## Seed, reset, provenance, parity

```bash
export FINERACT_COMPOSE_FILE=/absolute/path/to/blitzy-fineract/docker-compose-postgresql.yml
npm run check:backend    # proves the backend is Blitzy-Sandbox/blitzy-fineract, records its commit
npm run reset:db         # pull db -> recreate with --pull never -> wait for /actuator/health -> seed
npm run seed             # staff, loan product, loan charge, savings product (fixed values)
npm run e2e              # legacy baseline, then the new app, then parity-report.{md,json}
```

`reset:db` ends by running the seed, so `npm run seed` alone is for a backend that is already fresh;
the seed is not idempotent. `npm run e2e` runs every workflow against the legacy app first (port 9090,
with `?baseApiUrl=&tenantIdentifier=`), then the new app (port 4300): a legacy screen that no longer
works is reported `legacy-broken` without failing, and `parity-report.{md,json}` land in `web-ng/` (git-ignored).

Static gates:

```bash
npm run check:endpoints  # every Fineract URL in src/ is in tools/parity/endpoint-allowlist.json
npm run check:templates  # every in-scope legacy template endpoint is called by the new services
npm run check:wiring     # no dead injectable or component, no route drift, no spec without a test,
                         # no credential literal, no file written outside the boundary
npm run check:all        # all three, in that order
```

A human performs these steps: the Docker-backed `npm run e2e`, inspection of the parity report, the
legacy baseline (`docker build --platform linux/amd64 -t community-app-legacy .` then
`docker run -d --platform linux/amd64 -p 9090:80 community-app-legacy`), and the packaging check below.

## Development credentials

The development user is `mifos`; the password is not stored in the repository. The harness reads the user
name from `E2E_USER` or `FINERACT_USERNAME` and the password from `E2E_PASSWORD` or `FINERACT_PASSWORD`.

```bash
export E2E_USER=mifos
export E2E_PASSWORD=...      # supplied per environment, deliberately omitted here
```

Both are read at run time and have no default. Type them into the login screen for the human-verified
steps; no `Authorization` header, authentication key or password is ever logged or written to a capture,
and recorded requests and responses are masked before storage.

## Environments

Two verification environments, differing only by environment variables — never by code.

- **macOS (A):** `FINERACT_USER=502`, `FINERACT_GROUP=20`; accept the self-signed certificate once in
  the browser; ports 8443 (backend), 9090 (legacy), 4300 (new app).
- **Codespaces (B):** ids are commonly `1000/1000`; forward port 8443 as HTTPS with **Public**
  visibility for manual browser checks; URLs carry the query parameters, e.g.
  `https://<codespace>-9090.app.github.dev/?baseApiUrl=https://<codespace>-8443.app.github.dev&tenantIdentifier=default`
  and the same on port 4300, with no port number in the host.

Parity runs use the localhost defaults in both environments, because Playwright runs beside the
containers: `FINERACT_URL` (`https://localhost:8443`), `LEGACY_URL` (`http://localhost:9090`),
`NEXT_URL` (`http://localhost:4300`), tenant from `TENANT_ID` or `FINERACT_TENANT_ID` (`default`).

## Packaging

```bash
docker build -f Dockerfile.web-ng -t web-ng .
docker compose -f docker-compose.web-ng.yml up -d
```

Open `http://localhost:4300/`: the entrypoint rewrites `assets/config.json` from `API_BASE_URL` and
`TENANT_ID` at container start, and the browser calls Fineract directly, with no proxy in the image.

## Legacy assets

Translations (`app/global-translations/`), images (`app/images/`) and styles (`app/styles-dev/main/**`) are
wired through the `assets` mappings and `stylePreprocessorOptions.includePaths` in `angular.json`, never
copied. This checkout has no legacy `app/` tree: while a mapping or partial is absent the build uses only
the in-scope rules reproduced in `src/styles.scss`, and the mappings apply unchanged once it is restored.
