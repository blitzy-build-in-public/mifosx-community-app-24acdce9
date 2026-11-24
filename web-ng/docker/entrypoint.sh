#!/bin/sh
# Entrypoint of the nginx:alpine stage: rewrites apiBaseUrl and tenantId in the served
# assets/config.json from API_BASE_URL (default https://localhost:8443) and TENANT_ID
# (default "default"), keeps every other key byte-identical, then hands the container to
# nginx. No proxy is configured: the bundle is static and the browser calls Fineract directly.
set -eu
umask 022
WEB_ROOT=/usr/share/nginx/html
CONFIG="$WEB_ROOT/assets/config.json"
api_base_url="${API_BASE_URL:-https://localhost:8443}"
tenant_id="${TENANT_ID:-default}"
tmp="$CONFIG.tmp.$$"
recheck="$tmp.check"
cleanup() {
  if [ -n "$tmp" ]; then rm -f "$tmp"; fi
  if [ -n "$recheck" ]; then rm -f "$recheck"; fi
}
trap cleanup EXIT INT TERM
fail() {
  printf 'entrypoint: %s\n' "$1" >&2
  exit 1
}
escape() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}
# Rewrite the two keys this script owns, passing every other byte of the file through.
rewrite() {
  sed -e "s|\(\"apiBaseUrl\"[[:space:]]*:[[:space:]]*\"\)[^\"]*\"|\1$(escape "$api_base_url")\"|" \
      -e "s|\(\"tenantId\"[[:space:]]*:[[:space:]]*\"\)[^\"]*\"|\1$(escape "$tenant_id")\"|" \
      "$1"
}
[ -f "$CONFIG" ] && [ -r "$CONFIG" ] || fail "cannot read $CONFIG"
# The image has no JSON parser: the inputs alone keep the rewritten file valid JSON.
case "$api_base_url" in
  http://* | https://*) ;;
  *) fail "API_BASE_URL must start with http:// or https://" ;;
esac
case "$api_base_url" in
  *\"*|*\\*|*[[:space:]]*|*[[:cntrl:]]*) fail "API_BASE_URL holds a quote, a backslash or whitespace" ;;
esac
case "$tenant_id" in
  ""|*[!A-Za-z0-9._-]*) fail "TENANT_ID must be non-empty: letters, digits, dot, underscore, hyphen" ;;
esac
# Count occurrences, not matching lines: a compact config keeps every key on one line.
for key in apiBaseUrl tenantId; do
  if [ "$(grep -o "\"$key\"" "$CONFIG" | wc -l | tr -d ' ')" != 1 ]; then
    fail "$CONFIG must hold exactly one $key key"
  fi
done
# Write beside the target, prove its content and idempotence, then rename over it.
rewrite "$CONFIG" > "$tmp"
chmod 0644 "$tmp"
grep -q -F "$api_base_url" "$tmp" || fail "$CONFIG: apiBaseUrl was not rewritten"
grep -q -F "\"$tenant_id\"" "$tmp" || fail "$CONFIG: tenantId was not rewritten"
rewrite "$tmp" > "$recheck"
cmp -s "$tmp" "$recheck" || fail "$CONFIG: rewrite is not idempotent"
rm -f "$recheck"
mv "$tmp" "$CONFIG"
tmp=''; recheck=''
printf 'entrypoint: runtime configuration applied\n' >&2
exec nginx -g 'daemon off;'
