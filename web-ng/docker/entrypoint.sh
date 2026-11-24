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
# Rewrite the two keys this script owns, passing every other byte of the file through; the file
# argument may be - to read stdin.
rewrite() {
  sed -e "s|\(\"apiBaseUrl\"[[:space:]]*:[[:space:]]*\"\)[^\"]*\"|\1$(escape "$api_base_url")\"|" \
      -e "s|\(\"tenantId\"[[:space:]]*:[[:space:]]*\"\)[^\"]*\"|\1$(escape "$tenant_id")\"|" \
      "$1"
}
# Print the string value the key named $1 holds in the file $2, or on stdin for "-", so a check
# can compare what the file carries against what the rewrite must produce.
value_of() {
  sed -n "s|.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*|\1|p" "$2"
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
# Line 11 supplies the value, its default included, so this case guards only the characters that
# end up in the Fineract-Platform-TenantId header.
case "$tenant_id" in
  *[!A-Za-z0-9._-]*) fail "TENANT_ID must hold only letters, digits, dot, underscore or hyphen" ;;
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
[ "$(value_of apiBaseUrl "$tmp")" = "$api_base_url" ] || fail "$CONFIG: apiBaseUrl was not rewritten to API_BASE_URL"
[ "$(value_of tenantId "$tmp")" = "$tenant_id" ] || fail "$CONFIG: tenantId was not rewritten to TENANT_ID"
# The shipped values equal the documented defaults, so the rewritten file alone cannot show that
# the substitution ran. A sentinel neither a scheme-checked URL nor the tenant charset allows is
# written into both keys and put through this script's own rewrite, which must replace it.
probe=$(sed -e 's|"apiBaseUrl"[[:space:]]*:[[:space:]]*"[^"]*"|"apiBaseUrl":"probe:value"|' \
            -e 's|"tenantId"[[:space:]]*:[[:space:]]*"[^"]*"|"tenantId":"probe:value"|' "$tmp" | rewrite -)
[ "$(printf '%s\n' "$probe" | value_of apiBaseUrl -)" = "$api_base_url" ] || fail "$CONFIG: the rewrite does not substitute apiBaseUrl"
[ "$(printf '%s\n' "$probe" | value_of tenantId -)" = "$tenant_id" ] || fail "$CONFIG: the rewrite does not substitute tenantId"
rewrite "$tmp" > "$recheck"
cmp -s "$tmp" "$recheck" || fail "$CONFIG: rewrite is not idempotent"
rm -f "$recheck"
mv "$tmp" "$CONFIG"
tmp=''; recheck=''
printf 'entrypoint: runtime configuration applied\n' >&2
exec nginx -g 'daemon off;'
