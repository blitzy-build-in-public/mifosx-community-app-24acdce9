#!/usr/bin/env bash
# reset-db.sh — `npm run reset:db` (AAP 0.11.1 row 44, AAP 0.10.4 reset row, criteria 3, 4 and 12).
#
# Puts the parity fixture back into a known state before each UI's run, in four steps whose order is a
# requirement rather than a preference (AAP 0.10.4):
#   1. pull the PostgreSQL image, because a fresh machine holds none and step 2 may never pull;
#   2. recreate the stack from images already on disk (`--pull never`), so Docker can never substitute a
#      downloaded server for the locally built `fineract:latest` (Rule 2: Blitzy Fineract from source);
#   3. poll the backend's health endpoint until it reports UP instead of sleeping a fixed interval;
#   4. seed the fixed test data (AAP 0.10.1) once the backend answers.
#
# The seed is last because it is the only step that needs a working API, and it is not idempotent: it
# writes the fixed staff, loan product, loan charge and savings product into a freshly recreated
# database, so a second run on an unreset one is meant to fail (AAP 0.9.4 row 13).
#
# FINERACT_COMPOSE_FILE names the fork's own docker-compose-postgresql.yml of
# `Blitzy-Sandbox/blitzy-fineract`. That file lives outside this repository and its location differs
# between the two verification environments, so it is supplied per environment rather than guessed
# (AAP 0.10.4, AAP 0.8.2). Compose runs from that file's directory — a subshell each time — because its
# volumes interpolate ${PWD}; the caller therefore keeps the `web-ng` package directory that step 4 needs.
# AAP 0.9.4 row 10 assumes its PostgreSQL service is named `db`; a stack whose service is named otherwise
# fails at step 1, which prints this file's real service names before exiting non-zero.
#
# The health probe needs no credentials and no tenant header, and it is the only backend URL this script
# calls (tools/parity/harness-allowlist.json records it against this file). No credential, tenant value
# or auth key is read, echoed or passed on a command line here (Rule 1 clause 9).
#
# Portable across macOS bash 3.2 and Linux: no bash-4-only constructs, no GNU-only flags, no in-place
# rewrites of any file, no compose v1 binary. It writes nothing anywhere and changes no file of the legacy
# tree or of the backend clone, only starting Docker services that already exist (Rule 1 clause 1).
set -euo pipefail

if [ -z "${FINERACT_COMPOSE_FILE:-}" ]; then
  printf 'reset-db: FINERACT_COMPOSE_FILE is not set.\n' >&2
  printf 'reset-db: export FINERACT_COMPOSE_FILE="/path/to/blitzy-fineract/docker-compose-postgresql.yml"\n' >&2
  exit 1
fi

if [ ! -f "$FINERACT_COMPOSE_FILE" ] || [ ! -r "$FINERACT_COMPOSE_FILE" ]; then
  printf 'reset-db: FINERACT_COMPOSE_FILE is not a readable regular file: %s\n' "$FINERACT_COMPOSE_FILE" >&2
  exit 1
fi

FINERACT_URL="${FINERACT_URL:-https://localhost:8443}"
health_url="$FINERACT_URL/fineract-provider/actuator/health"
compose_dir=$(cd "$(dirname "$FINERACT_COMPOSE_FILE")" && pwd)
compose_file="$compose_dir/$(basename "$FINERACT_COMPOSE_FILE")"

# Step 1 — the database image, and the only pull this script performs.
printf 'reset-db: step 1/4 pulling the PostgreSQL image\n'
if ! ( cd "$compose_dir" && docker compose -f "$compose_file" pull db ); then
  printf 'reset-db: could not pull the db service; this compose file defines:\n' >&2
  ( cd "$compose_dir" && docker compose -f "$compose_file" config --services ) >&2 || true
  printf 'reset-db: AAP 0.9.4 row 10 assumes the PostgreSQL service is named db.\n' >&2
  exit 1
fi

# Step 2 — recreate every service, pulling nothing: `fineract:latest` is built locally (Rule 2).
printf 'reset-db: step 2/4 recreating the stack with --pull never\n'
( cd "$compose_dir" && docker compose -f "$compose_file" up -d --force-recreate --pull never )

# Step 3 — readiness, not a fixed sleep. `-k` because the fork serves a self-signed certificate.
printf 'reset-db: step 3/4 waiting for %s\n' "$health_url"
max_attempts=90
attempt=0
until curl -kfsS --max-time 5 "$health_url" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"UP"'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    printf 'reset-db: backend is not UP after %s attempts: %s\n' "$max_attempts" "$health_url" >&2
    printf 'reset-db: inspect it with: docker compose -f "%s" logs\n' "$compose_file" >&2
    exit 1
  fi
  sleep 2
done
printf 'reset-db: backend reports UP\n'

# Step 4 — the seed, which `npm run reset:db` reaches from the `web-ng` package directory.
if [ ! -f package.json ]; then
  printf 'reset-db: no package.json in %s; run this through npm at the web-ng package root.\n' "$PWD" >&2
  exit 1
fi
printf 'reset-db: step 4/4 seeding the fixed test data\n'
npm run seed

printf 'reset-db: database reset and seed complete\n'
