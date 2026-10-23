#!/usr/bin/env bash
# Backs up the AWS host's stateful data to S3 (#111). Runs as root on the host,
# started by `make aws-backup` (infra/scripts/host-run.sh) through SSM.
#
# Writes one prefix, s3://$BACKUP_BUCKET/$BACKUP_PREFIX/, holding:
#   pds.tar        the PDS data volume: account SQLite databases and blobs
#   plc.dump       the PLC database (pg_dump custom format)
#   postgres.dump  the AppView database (pg_dump custom format)
#   manifest.json  hostname, deployed commit, and when the backup was taken
#
# The PDS, PLC, and everything that writes to Postgres stop for the duration,
# so the three copies describe the same moment. They start again on exit,
# whether or not the backup succeeded. Clients see the PDS down for about as
# long as the upload takes.
#
# Not copied: Redis and Jetstream (caches, rebuilt on start), and media
# renditions (in their own S3 bucket, or regenerated from PDS blobs).
: "${BACKUP_BUCKET:?S3 bucket, the BackupBucket stack output}"
: "${BACKUP_PREFIX:?key prefix for this backup, e.g. dev/2026-10-23T120000Z}"
OPENREEL_DIR="${OPENREEL_DIR:-/srv/openreel}"

set -euo pipefail

# Services that write account or index data. Postgres and plc-db keep running
# so they can be dumped.
writers=(pds plc event-consumer media appview feedgen admin)

step() { printf '\n==> %s\n' "$*"; }

cd "$OPENREEL_DIR"
[[ -f compose.yaml && -f .env ]] || {
  echo "error: no deployment in $OPENREEL_DIR; deploy first" >&2
  exit 1
}
hostname="$(sed -n 's/^PDS_HOSTNAME=//p' .env)"
sha="$(sed -n 's/^IMAGE_TAG=//p' .env)"
dest="s3://$BACKUP_BUCKET/$BACKUP_PREFIX"

upload() { aws s3 cp --only-show-errors - "$dest/$1"; }

step "Stopping writers: ${writers[*]}"
trap 'step "Starting writers"; docker compose start "${writers[@]}"' EXIT
docker compose stop "${writers[@]}"

step "Dumping the PLC database"
docker compose exec -T plc-db pg_dump -U plc -d plc -Fc | upload plc.dump

step "Dumping the AppView database"
docker compose exec -T postgres pg_dump -U openreel -d openreel -Fc | upload postgres.dump

step "Archiving the PDS data volume"
# A one-off container with the PDS's volume mounted; the PDS itself is stopped.
# Blobs are already-compressed video, so the archive is not compressed.
docker compose run --rm --no-deps -T --entrypoint tar pds -C /pds -cf - . | upload pds.tar

step "Writing the manifest"
jq -n --arg hostname "$hostname" --arg sha "$sha" --arg taken "$(date -u +%FT%TZ)" \
  '{hostname: $hostname, sha: $sha, takenAt: $taken, files: ["pds.tar", "plc.dump", "postgres.dump"]}' |
  upload manifest.json

aws s3 ls --human-readable "$dest/"
step "Backed up to $dest/"
