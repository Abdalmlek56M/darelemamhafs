# shellcheck shell=bash
# =============================================================================
# Dar production update - console/log helpers, privileges and exit handling
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : step, info, warn, fail, on_exit, detect_privileges,
#           resolve_repo_owner, run_as_owner, init_logging.
# Notes   : these helpers intentionally reference configuration variables that
#           are initialised by deploy/lib/update-config.sh in the same shell.
# =============================================================================
# shellcheck disable=SC2154

step() {
  printf '\n==> %s\n' "$*"
}

info() {
  printf '    %s\n' "$*"
}

warn() {
  printf '    WARN: %s\n' "$*" >&2
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  printf 'Log: %s\n' "$LOG_FILE" >&2
  exit 1
}

on_exit() {
  if [ "$SWAPPED" -eq 1 ]; then
    printf '\nWARN: update exited while new binaries were live. Run deploy/rollback.sh %s to revert binaries.\n' "$STAMP" >&2
  elif [ "$SERVICES_STOPPED" -eq 1 ]; then
    printf '\nWARN: update exited with the services stopped; restarting them with the previous binaries.\n' >&2
    $SUDO systemctl start dar-legacy.service dar-api.service >/dev/null 2>&1 || true
    SERVICES_STOPPED=0
  fi
}

detect_privileges() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
  else
    if ! sudo -n true 2>/dev/null; then
      echo "update.sh must run as root or as a user with passwordless sudo." >&2
      exit 1
    fi
    SUDO="sudo"
  fi
}

resolve_repo_owner() {
  REPO_OWNER="$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo root)"
  REPO_OWNER_HOME="$(getent passwd "$REPO_OWNER" 2>/dev/null | cut -d: -f6 || true)"
  [ -n "$REPO_OWNER_HOME" ] || REPO_OWNER_HOME="/home/$REPO_OWNER"
}

run_as_owner() {
  if [ "$(id -u)" -eq 0 ] && [ "$REPO_OWNER" != "root" ]; then
    runuser -u "$REPO_OWNER" -- env HOME="$REPO_OWNER_HOME" USER="$REPO_OWNER" LOGNAME="$REPO_OWNER" "$@"
  else
    "$@"
  fi
}

# Redirect stdout/stderr of the whole script (not just this function) into the
# per-run log file while still showing the output on the terminal.
init_logging() {
  $SUDO install -d -m 0755 -o root -g root "$LOG_DIR"
  if [ -n "$SUDO" ]; then
    exec > >($SUDO tee -a "$LOG_FILE") 2>&1
  else
    exec > >(tee -a "$LOG_FILE") 2>&1
  fi
}
