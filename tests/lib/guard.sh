#!/usr/bin/env bash
# tests/lib/guard.sh — shared production-safety guard for shell regression wrappers.
#
# Source it from tests/regression/**/run.sh:
#   . "$(cd "$(dirname "$0")/../../lib" && pwd)/guard.sh"
#
# Rules (same contract as tests/lib/index.mjs — ONE guard, two languages):
#   * DB names: DAR_TEST_DB_ALLOWLIST allow-list first (comma list, `*` globs),
#     otherwise the legacy DAR_FORBIDDEN_DB / DAR_FORBIDDEN_DB_NAMES deny-list.
#   * Test URLs: loopback HTTP only (127.0.0.1 / localhost / ::1).
# A violation prints "<LABEL> refusing: <reason>" on stderr and exits 2.

dar_guard_fail() {
  local label="$1"
  shift
  printf '%s refusing: %s\n' "$label" "$*" >&2
  exit 2
}

dar_guard_require_env() {
  local label="$1"
  shift
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      dar_guard_fail "$label" "$name is required"
    fi
  done
}

dar_guard_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

dar_guard_db_name() {
  local label="$1"
  local connection="${2:-}"
  local name
  name="$(printf '%s' "$connection" | tr ';' '\n' | awk -F= '
    tolower($1) ~ /^[[:space:]]*database[[:space:]]*$/ { sub(/^[^=]*=/, ""); print; exit }
  ')"
  name="$(dar_guard_trim "$name")"
  local allowlist="${DAR_TEST_DB_ALLOWLIST:-}"
  if [ -n "$allowlist" ]; then
    [ -n "$name" ] || dar_guard_fail "$label" "database name is missing from DAR_TEST_DATABASE but DAR_TEST_DB_ALLOWLIST is set"
    local lower_name lower_pattern old_ifs
    lower_name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    old_ifs="$IFS"
    IFS=','
    for pattern in $allowlist; do
      pattern="$(printf '%s' "$(dar_guard_trim "$pattern")" | tr '[:upper:]' '[:lower:]')"
      [ -n "$pattern" ] || continue
      case "$lower_name" in
        $pattern) IFS="$old_ifs"; return 0 ;;
      esac
    done
    IFS="$old_ifs"
    dar_guard_fail "$label" "database \"$name\" is not in the DAR_TEST_DB_ALLOWLIST allow-list ($allowlist)"
  fi
  local denied
  for denied in "${DAR_FORBIDDEN_DB:-}" "${DAR_FORBIDDEN_DB_NAMES:-}"; do
    [ -n "$denied" ] || continue
    local old_ifs="$IFS"
    IFS=','
    for pattern in $denied; do
      pattern="$(printf '%s' "$(dar_guard_trim "$pattern")" | tr '[:upper:]' '[:lower:]')"
      [ -n "$pattern" ] || continue
      case "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" in
        $pattern) IFS="$old_ifs"; dar_guard_fail "$label" "production/forbidden database name \"$name\"" ;;
      esac
    done
    IFS="$old_ifs"
  done
  return 0
}

dar_guard_loopback_urls() {
  local label="$1"
  shift
  local raw
  for raw in "$@"; do
    case "$raw" in
      http://127.0.0.1|http://127.0.0.1/*|http://127.0.0.1:*|http://localhost|http://localhost/*|http://localhost:*|http://\[::1\]|http://\[::1\]/*|http://\[::1\]:*) ;;
      *) dar_guard_fail "$label" "non-loopback test URL ${raw:-<empty>}" ;;
    esac
  done
}

# Convenience: require env + guard a DB connection string + guard URLs.
# dar_guard_targets <LABEL> <DB_CONN> <URL> [URL...]
dar_guard_targets() {
  local label="$1"
  local db="$2"
  shift 2
  dar_guard_db_name "$label" "$db"
  dar_guard_loopback_urls "$label" "$@"
}
