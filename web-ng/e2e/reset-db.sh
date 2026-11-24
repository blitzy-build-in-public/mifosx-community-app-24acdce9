#!/usr/bin/env bash
# reset-db.sh — `npm run reset:db` (AAP 0.11.1 row 44, AAP 0.10.4 reset row, criteria 3, 4 and 12).
#
# Puts the parity fixture back into a known state before each UI's run, in four steps whose order is a
# requirement rather than a preference (AAP 0.10.4):
#   1. pull the PostgreSQL image, because a fresh machine holds none and step 2 may never pull;
#   2. recreate the stack from images already on disk (`--pull never`), so Docker can never substitute a
#      downloaded server for the locally built `fineract:latest` (Rule 2: Blitzy Fineract from source);
#   3. poll the backend's health endpoint until it reports UP instead of sleeping a fixed interval,
#      for up to 15 minutes by default: 450 attempts 2 seconds apart. The fork's compose file declares
#      no data volume for PostgreSQL, so step 2's `--force-recreate` discards the cluster and every
#      reset replays the Liquibase migrations from empty, a first start measured at 2-8 minutes; a
#      shorter bound would fail a healthy run on a loaded host. FINERACT_HEALTH_MAX_ATTEMPTS overrides
#      the attempt count (a positive integer, same 2-second interval) and defaults to 450 when unset or
#      empty; a value that is not a positive integer exits 1 before any docker or curl call;
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

# Step 3's bound, read and checked before anything talks to Docker or the backend, so a typo fails
# here instead of fifteen minutes into a wait. The interval is named once, so the attempt count and
# the seconds it stands for cannot drift apart.
health_poll_interval=2
health_max_attempts_raw="${FINERACT_HEALTH_MAX_ATTEMPTS:-}"
if [ -z "$health_max_attempts_raw" ]; then
  health_max_attempts=450
else
  health_max_attempts=$health_max_attempts_raw
  case "$health_max_attempts_raw" in
    *[!0-9]*)
      health_max_attempts='' # a sign, a space or a decimal: rejected below
      ;;
    *)
      # Leading zeros are accepted, but `[` and `$(( ))` read 010 as octal, so strip them first.
      while [ "${health_max_attempts#0}" != "$health_max_attempts" ]; do
        health_max_attempts=${health_max_attempts#0}
      done
      ;;
  esac
  if [ -z "$health_max_attempts" ]; then
    printf 'reset-db: FINERACT_HEALTH_MAX_ATTEMPTS must be a positive integer number of attempts; received "%s".\n' "$health_max_attempts_raw" >&2
    exit 1
  fi
fi

# The backend address is the one setting the whole harness shares — the seed, the snapshot and the
# page objects all read this same `FINERACT_URL` — so it is resolved here exactly as
# `seed/fixtures.ts`'s `resolveBaseUrl` resolves it: whitespace around the value is not part of the
# address, an empty or whitespace-only value means "unset" and falls back to the locally built
# Fineract (Rule 2), and every trailing slash is dropped so the health path below cannot double one.
# The caller's `FINERACT_URL` is left as it was set; only this local copy is adjusted.
trim_whitespace() {
  # `String.prototype.trim` in parameter expansion alone — no sed, no tr — so macOS bash 3.2 and Linux
  # bash resolve the same address from the same value.
  local value="$1"
  value=${value#"${value%%[![:space:]]*}"}
  value=${value%"${value##*[![:space:]]}"}
  printf '%s' "$value"
}

fineract_url=$(trim_whitespace "${FINERACT_URL:-}")
if [ -z "$fineract_url" ]; then
  fineract_url='https://localhost:8443'
fi
while [ "${fineract_url%/}" != "$fineract_url" ]; do
  fineract_url=${fineract_url%/}
done
health_url="$fineract_url/fineract-provider/actuator/health"
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
printf 'reset-db: step 3/4 waiting for %s (up to %s attempts, %s seconds apart)\n' \
  "$health_url" "$health_max_attempts" "$health_poll_interval"
attempt=0
until curl -kfsS --max-time 5 "$health_url" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"UP"'; do
  attempt=$((attempt + 1))
  sleep "$health_poll_interval"
  if [ "$attempt" -ge "$health_max_attempts" ]; then
    waited_seconds=$((attempt * health_poll_interval))
    # Both units when the wait is a minute or more, seconds alone below that, so an overridden
    # short bound never reports itself as "0 minutes".
    if [ "$waited_seconds" -ge 60 ]; then
      waited_text="${waited_seconds} seconds ($((waited_seconds / 60)) minutes)"
    else
      waited_text="${waited_seconds} seconds"
    fi
    printf 'reset-db: backend is not UP after %s attempts over %s: %s\n' \
      "$attempt" "$waited_text" "$health_url" >&2
    printf 'reset-db: every reset replays the Liquibase migrations from an empty cluster; raise FINERACT_HEALTH_MAX_ATTEMPTS to wait longer.\n' >&2
    printf 'reset-db: inspect it with: docker compose -f "%s" logs\n' "$compose_file" >&2
    exit 1
  fi
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
