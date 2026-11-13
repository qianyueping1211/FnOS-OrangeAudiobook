#!/bin/bash
# Run only in the disposable GitHub packaging container, never on a user's NAS.
set -Eeuo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] && [ "$(id -u)" -eq 0 ] || {
    echo "This test requires a disposable root GitHub Actions container." >&2
    exit 1
}
PACKAGE="$(realpath .github/ting-reader-fpk-native)"
ROOT="$(mktemp -d /tmp/ting-lifecycle-XXXXXX)"
chmod 755 "$ROOT"
getent passwd ting-reader >/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin ting-reader
export TRIM_APPDEST="$ROOT/target" TRIM_PKGVAR="$ROOT/var" TRIM_APPDEST_VOL="$ROOT/volume"
export TRIM_TEMP_LOGFILE="$ROOT/callback.log"
export TRIM_DATA_SHARE_PATHS="$ROOT/data:$ROOT/storage:$ROOT/plugins:$ROOT/temp"
cleanup() {
    bash "$PACKAGE/cmd/main" stop || true
    rm -f /usr/local/libexec/ting-reader-updater /etc/sudoers.d/ting-reader-updater
    rm -rf -- "$ROOT"
}
trap cleanup EXIT
cp -a "$PACKAGE/app" "$TRIM_APPDEST"
mkdir -p "$TRIM_PKGVAR" "$ROOT/data" "$ROOT/storage" "$ROOT/plugins" "$ROOT/temp"
chown ting-reader:ting-reader "$ROOT/"{data,storage,plugins,temp}
touch "$ROOT/data/preserved"
bash "$PACKAGE/cmd/install_init"
# Catch the original failure: a package-user callback must explain missing root.
touch "$TRIM_TEMP_LOGFILE"
chmod 666 "$TRIM_TEMP_LOGFILE"
if runuser -u ting-reader -- bash "$PACKAGE/cmd/install_callback"; then
    echo "Unprivileged installation incorrectly succeeded." >&2
    exit 1
fi
grep -q 'requires root lifecycle mode' "$TRIM_TEMP_LOGFILE"
bash "$PACKAGE/cmd/install_callback"
bash "$PACKAGE/cmd/upgrade_callback"
test -f "$ROOT/data/preserved"
test "$(stat -c '%U:%G:%a' /usr/local/libexec/ting-reader-updater)" = root:root:755
test "$(stat -c '%U:%G:%a' /etc/sudoers.d/ting-reader-updater)" = root:root:440
visudo -cf /etc/sudoers.d/ting-reader-updater
runuser -u ting-reader -- sudo -n /usr/local/libexec/ting-reader-updater status >/dev/null
if runuser -u ting-reader -- test -w /usr/local/libexec/ting-reader-updater; then
    echo "Service user can modify the root helper." >&2
    exit 1
fi
if runuser -u ting-reader -- test -w "$TRIM_APPDEST/server/ting-reader"; then
    echo "Service user can modify installed code." >&2
    exit 1
fi
bash "$PACKAGE/cmd/main" start
PID="$(cat "$TRIM_PKGVAR/run/app.pid")"
test "$(stat -c %u "/proc/$PID")" = "$(id -u ting-reader)"
bash "$PACKAGE/cmd/main" status
curl --silent --fail --unix-socket "$TRIM_APPDEST/ting-reader.sock" http://localhost/api/health | grep healthy
# start is idempotent and does not create a second server.
bash "$PACKAGE/cmd/main" start
test "$(cat "$TRIM_PKGVAR/run/app.pid")" = "$PID"
bash "$PACKAGE/cmd/main" stop
if bash "$PACKAGE/cmd/main" status; then exit 1; else test "$?" -eq 3; fi
test ! -e "$TRIM_PKGVAR/run/app.pid"
test ! -S "$TRIM_PKGVAR/run/ting-reader.sock"
echo "Root callbacks, unprivileged service, gateway readiness and lifecycle checks passed."
