#!/usr/bin/env bash
# Restores a backup taken by backup.sh (#111). Runs as root on the host,
# started by `make aws-restore` (infra/scripts/host-run.sh) through SSM.
#
# DESTRUCTIVE: replaces every account, post, PLC operation, and index row on
# this host with the backup's. The host must have been deployed at least once
# (deploy.sh writes compose.yaml and .env), with the same secrets as the host
# the backup came from (infra/scripts/import-secrets.sh) and the same
# PDS_HOSTNAME, which every DID document names.
#
# Steps: check the manifest, remove the stack and its volumes, restore the two
# databases and the PDS volume, migrate (ADR-0003), and start everything.
: "${BACKUP_BUCKET:?S3 bucket, the BackupBucket stack output}"
: "${BACKUP_PREFIX:?key prefix of the backup to restore}"
OPENREEL_DIR="${OPENREEL_DIR:-/srv/openreel}"

set -euo pipefail

step() { printf '\n==> %s\n' "$*"; }

cd "$OPENREEL_DIR"
[[ -f compose.yaml && -f .env ]] || {
  echo "error: no deployment in $OPENREEL_DIR; run the deploy workflow once first" >&2
  exit 1
}
src="s3://$BACKUP_BUCKET/$BACKUP_PREFIX"
download() { aws s3 cp --only-show-errors "$src/$1" -; }

step "Checking $src/manifest.json"
manifest="$(download manifest.json)"
backup_hostname="$(jq -r .hostname <<<"$manifest")"
hostname="$(sed -n 's/^PDS_HOSTNAME=//p' .env)"
if [[ "$backup_hostname" != "$hostname" ]]; then
  echo "error: the backup is of $backup_hostname but this host is $hostname." >&2
  echo "error: DID documents name the PDS hostname, so accounts would not resolve." >&2
  exit 1
fi
jq . <<<"$manifest"

step "Removing the stack and its volumes"
docker compose --profile tools down --volumes --remove-orphans

step "Starting the databases"
docker compose up -d --wait postgres plc-db

step "Restoring the PLC database"
download plc.dump | docker compose exec -T plc-db pg_restore -U plc -d plc --no-owner --exit-on-error

step "Restoring the AppView database"
download postgres.dump |
  docker compose exec -T postgres pg_restore -U openreel -d openreel --no-owner --exit-on-error

step "Restoring the PDS data volume"
download pds.tar | docker compose run --rm --no-deps -T --entrypoint tar pds -C /pds -xpf -

step "Migrating"
docker compose run --rm migrate

step "Starting"
docker compose up -d --remove-orphans --wait --wait-timeout 300 || {
  docker compose ps
  docker compose logs --tail 50
  exit 1
}
docker compose ps
step "Restored $src/"
