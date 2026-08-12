#!/usr/bin/env bash
#
# Backs up the `nonni-data` volume together with the `.env` that goes with it.
#
# The two belong together, and this is the part not to miss: the volume holds the
# Google refresh token **encrypted**, and only `TOKEN_KEY` decrypts it. An archive
# without its `.env` means going through Google consent again.
#
#   ./deploy/backup.sh            local archive, then upload through rclone
#   ./deploy/backup.sh --local    local archive only (what deploy.sh calls)
#
# The rclone remote is configured outside the repository (`rclone config`) and
# named by NONNI_BACKUP_REMOTE. No secret lives here.

set -euo pipefail

cd "$(dirname "$0")/.."

DESTINATION=${NONNI_BACKUP_DIR:-$PWD/backups}
# Any rclone remote will do — S3 and compatibles, Backblaze B2, a remote disk
# over SFTP. `rclone config` names it, NONNI_BACKUP_REMOTE points at it; the
# repository favours none of them and knows none of their secrets.
REMOTE=${NONNI_BACKUP_REMOTE:-backups:nonni}
RETENTION=7

local_only=false
case "${1:-}" in
'') ;;
--local) local_only=true ;;
*)
  echo "usage: $0 [--local]" >&2
  exit 2
  ;;
esac

if [[ ! -f .env ]]; then
  echo "No .env here: run this script from the instance's repository." >&2
  exit 1
fi

# The volume only exists once the instance has started at least once. On a fresh
# install there is nothing to back up, and that is not an error — it is however
# to be told apart from a volume that exists but is empty, further down.
if ! docker volume inspect nonni-data >/dev/null 2>&1; then
  echo "No nonni-data volume: instance never started, nothing to back up."
  exit 0
fi

mkdir -p "$DESTINATION"
# Absolute path required: docker reads `-v relative/path:/…` as a **named
# volume**, and would therefore mount an empty one without complaining.
DESTINATION=$(cd "$DESTINATION" && pwd)
timestamp=$(date +%F-%H%M%S)
archive="$DESTINATION/nonni-$timestamp.tar.gz"
secrets="$DESTINATION/nonni-$timestamp.env"
# `.tgz` rather than `.tar.gz`, and it is not an affectation: pruning tells the
# archives apart by pattern, and `nonni-*.tar.gz` would swallow this one.
# Retention would drop to three real backups instead of seven, silently.
configuration="$DESTINATION/nonni-$timestamp.config.tgz"

# The stop lasts a few seconds, and that is the price of a SQLite at rest: no WAL
# in flight when `tar` runs. The trade-off is deliberate against a hot
# `db.backup()`, which is more fragile to trigger from outside the container.
#
# An instance that is already down is archived as it stands, and left down.
# `docker compose start` exits 1 when the service has no container at all, which
# under `set -e` killed this script one line before the end — and with it the
# `deploy.sh` that called it. An update was then impossible because the
# application was not running, and the application was not running because the
# update could not run (D260812).
if [[ -n $(docker compose ps -q app) ]]; then
  was_running=true
  echo "→ stopping the application"
  docker compose stop app
  # `start` even on failure: a failed backup must not leave the instance down.
  trap 'docker compose start app >/dev/null' EXIT
else
  was_running=false
  echo "→ application already down: archiving as it stands"
fi

echo "→ archiving nonni-data"
# The container writes as root, so the archive belongs to root, mode 0644. It
# stays readable by rclone and removable by pruning, which only needs write
# permission on the directory.
docker run --rm \
  -v nonni-data:/data:ro \
  -v "$DESTINATION:/out" \
  alpine tar czf "/out/$(basename "$archive")" -C /data .

# Compose used to prefix volumes with the working directory name: `-v
# nonni-data:…` then mounted a brand-new empty volume and produced an empty
# archive without a word of warning (D53). The explicit `name:` in
# docker-compose.yml fixed the cause; this check verifies the effect, because it
# is precisely the kind of failure only a restore reveals.
#
# The listing goes through a variable rather than a pipe: `grep -q` exits on the
# first match, `tar` would take a SIGPIPE, and `pipefail` would fail the test on
# a perfectly valid archive.
contents=$(tar tzf "$archive")
if ! grep -q 'nonni\.db' <<<"$contents"; then
  echo "Archive without nonni.db — the wrong volume was mounted. Nothing backed up." >&2
  rm -f "$archive"
  exit 1
fi

cp .env "$secrets"
chmod 600 "$secrets"

# `config/` is mounted from the host: neither the volume tar nor the `.env`
# carries it. It holds the service account key, which Google hands over **once** —
# a restore without it returns the database and the accounts but no access to
# Drive at all, and the failure only shows up at the first sync.
# The whole directory rather than a list: filtering would mean a pattern to keep
# in step with `.gitignore`, and the git-tracked example that rides along weighs
# two kilobytes.
if [[ -d config ]]; then
  tar czf "$configuration" config
  chmod 600 "$configuration"
fi

if $was_running; then
  docker compose start app >/dev/null
  trap - EXIT
  echo "→ application restarted"
fi

# Pruning. The names are produced here, without spaces or newlines: splitting
# `ls` output is safe in this particular case.
prune() {
  local pattern=$1 old
  # A `for` loop rather than `| while`: under `pipefail`, an `ls` with no match
  # would fail the whole pipeline, and therefore the script, on an empty
  # directory.
  # shellcheck disable=SC2012,SC2086
  for old in $(ls -1t "$DESTINATION"/$pattern 2>/dev/null | tail -n "+$((RETENTION + 1))"); do
    echo "  · pruning $(basename "$old")"
    rm -f "$old"
  done
}
prune 'nonni-*.tar.gz'
prune 'nonni-*.env'
prune 'nonni-*.config.tgz'

echo "✓ $(basename "$archive") ($(du -h "$archive" | cut -f1)), its .env$(
  [[ -f $configuration ]] && echo ' and its config/'
)"

if [[ $local_only == true ]]; then
  exit 0
fi

# A backup living on the machine it protects protects nothing.
if ! command -v rclone >/dev/null; then
  echo "rclone missing: archive kept locally. Install it, or pass --local." >&2
  exit 1
fi

echo "→ uploading to $REMOTE"
rclone copy "$archive" "$REMOTE"
rclone copy "$secrets" "$REMOTE"
# `if` rather than `[[ … ]] &&`: under `set -e`, a false test as the script's last
# statement would exit non-zero, when a missing `config/` is a normal case — an
# OAuth-only instance has none.
if [[ -f $configuration ]]; then
  rclone copy "$configuration" "$REMOTE"
fi
echo "✓ uploaded"
